// apps/web/src/pages/ClientRegister.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getClientProfile, updateClientProfile } from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import PhoneOTP from "../components/PhoneOTP.jsx";

/* Optional image upload (uses same Cloudinary env as Settings) */
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "";

/** Client registration/profile with OTP + optional KYC + agreements (Terms/Privacy only). */
export default function ClientRegister() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState(null);

  const [stateVal, setStateVal] = useState("");
  const [lga, setLga] = useState("");
  const [address, setAddress] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  // KYC (optional)
  const [verifyNow, setVerifyNow] = useState(false);
  const [idType, setIdType] = useState("");
  const [idUrl, setIdUrl] = useState("");
  const [selfieWithIdUrl, setSelfieWithIdUrl] = useState("");

  // Agreements
  const [agreements, setAgreements] = useState({ terms: false, privacy: false });

  // Location
  const [locLoading, setLocLoading] = useState(false);
  const [lat, setLat] = useState(null);
  const [lon, setLon] = useState(null);

  // Nearby preview
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [nearby, setNearby] = useState([]);

  const okTimerRef = useRef(null);
  function flashOK(msg) {
    setOk(msg);
    clearTimeout(okTimerRef.current);
    okTimerRef.current = setTimeout(() => setOk(""), 2200);
  }

  // Prefill from server
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const data = await getClientProfile().catch(() => null);
        if (!alive) return;
        if (data) {
          setFullName(data.fullName || "");
          setPhone(data.phone || "");
          if (data.phoneVerifiedAt) setPhoneVerifiedAt(data.phoneVerifiedAt);

          setStateVal(data.state || "");
          setLga((data.lga || "").toString().toUpperCase());
          setAddress(data.address || "");
          setPhotoUrl(data.photoUrl || "");
          if (data.lat != null) setLat(data.lat);
          if (data.lon != null) setLon(data.lon);

          const acceptedTerms = !!data.acceptedTerms || !!data?.agreements?.terms;
          const acceptedPrivacy = !!data.acceptedPrivacy || !!data?.agreements?.privacy;
          if (acceptedTerms || acceptedPrivacy) {
            setAgreements({ terms: acceptedTerms, privacy: acceptedPrivacy });
          }

          const kyc = data.kyc || {};
          if (kyc?.idType || kyc?.idUrl || kyc?.selfieWithIdUrl) {
            setVerifyNow(true);
            setIdType(kyc.idType || "");
            setIdUrl(kyc.idUrl || "");
            setSelfieWithIdUrl(kyc.selfieWithIdUrl || "");
          }
        }
      } catch {
        if (alive) setErr("Unable to load your profile.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      clearTimeout(okTimerRef.current);
    };
  }, []);

  const canSave = useMemo(() => {
    const base = !!fullName && !!phone && (!!stateVal || !!lga) && !!address;
    const agreed = agreements.terms && agreements.privacy;
    if (!verifyNow) return base && agreed;
    return base && agreed && !!idType && !!idUrl && !!selfieWithIdUrl;
  }, [fullName, phone, stateVal, lga, address, verifyNow, idType, idUrl, selfieWithIdUrl, agreements]);

  async function save() {
    try {
      setErr("");
      const payload = {
        fullName,
        phone,
        state: stateVal,
        lga: (lga || stateVal || "").toString().toUpperCase(),
        address,
        photoUrl,
        ...(lat != null && lon != null ? { lat, lon } : {}),
        ...(phoneVerifiedAt ? { phoneVerifiedAt } : {}),
        acceptedTerms: !!agreements.terms,
        acceptedPrivacy: !!agreements.privacy,
        agreements: { terms: !!agreements.terms, privacy: !!agreements.privacy },
      };
      if (verifyNow) {
        payload.kyc = { idType, idUrl, selfieWithIdUrl, status: "pending" };
      }
      await updateClientProfile(payload); // PUT /api/profile/client/me (alias: /api/profile/me)
      flashOK("Saved!");
      nav("/browse", { replace: true });
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to save.");
    }
  }

  async function useMyLocation() {
    try {
      setLocLoading(true);
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      );
      const { latitude: theLat, longitude: theLon } = pos.coords;

      const { data } = await api.get("/api/geo/rev", { params: { lat: theLat, lon: theLon } });
      const feat = data?.features?.[0];
      const p = feat?.properties || {};

      const detectedState = (p.state || p.region || "").toString().toUpperCase();
      const detectedLga = (p.county || p.city || p.district || p.suburb || "").toString().toUpperCase();
      const detectedAddress = [p.address_line1, p.address_line2].filter(Boolean).join(", ");

      setStateVal((s) => detectedState || s);
      setLga((l) => detectedLga || l);
      setAddress((a) => detectedAddress || a);
      setLat(theLat);
      setLon(theLon);

      flashOK("Location detected.");
    } catch (e) {
      alert(
        e?.message?.includes("Only secure origins")
          ? "Location requires HTTPS. Use your ngrok URL on phone, or localhost on your laptop."
          : "Could not get your location. Please allow location permission."
      );
    } finally {
      setLocLoading(false);
    }
  }

  async function loadNearby() {
    if (lat == null || lon == null) {
      alert("Click ‘Use my location’ first so we can find professionals near you.");
      return;
    }
    try {
      setNearbyBusy(true);
      const { data } = await api.get("/api/barbers/nearby", {
        params: { lat, lon, radiusKm: 25 },
      });
      setNearby(data?.items || []);
      if (!data?.items?.length) flashOK("No professionals within 25km (yet).");
    } catch {
      setErr("Could not search nearby professionals.");
    } finally {
      setNearbyBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Tell us about you</h1>
      <p className="text-zinc-400 mb-4">Save your details once. Future bookings will be instant — no long forms.</p>

      {err && <div className="mb-4 rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">{err}</div>}
      {ok && <div className="mb-4 rounded border border-green-800 bg-green-900/30 text-green-100 px-3 py-2">{ok}</div>}

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="space-y-6">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="relative w-16 h-16 rounded-full border border-zinc-800 overflow-hidden"
              title="Upload photo"
              onClick={() => openUpload(setPhotoUrl, "kpocha/clients")}
            >
              {photoUrl ? (
                <img src={photoUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-zinc-500 text-xs">
                  Add Photo
                </div>
              )}
            </button>
            {photoUrl && (
              <button
                className="text-xs text-red-300 border border-red-800 rounded px-2 py-1"
                onClick={() => setPhotoUrl("")}
              >
                Remove
              </button>
            )}
          </div>

          {/* Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            <div>
              <Input
                label={`Phone${phoneVerifiedAt ? " (verified)" : ""}`}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setPhoneVerifiedAt(null);
                }}
                required
              />
              <PhoneOTP phone={phone} disabled={!phone} onVerified={(iso) => setPhoneVerifiedAt(iso)} />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm text-zinc-300 mb-1">State &amp; LGA</label>
            <NgGeoPicker
              valueState={stateVal}
              onChangeState={setStateVal}
              valueLga={lga}
              onChangeLga={setLga}
              required
              className="grid grid-cols-1 gap-3"
            />

            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locLoading}
                className="text-sm px-3 py-1.5 rounded border border-emerald-600 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-60"
              >
                {locLoading ? "Detecting…" : "Use my location"}
              </button>
              <span className="text-xs text-zinc-500">Fills State, LGA and Address automatically.</span>
            </div>
          </div>

          <Input label="Address / Landmark" value={address} onChange={(e) => setAddress(e.target.value)} required />

          {/* KYC */}
          <div className="rounded border border-zinc-800 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={verifyNow} onChange={(e) => setVerifyNow(e.target.checked)} />
              Verify my identity now (recommended)
            </label>

            {verifyNow && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-sm text-zinc-300 mb-1">ID Type *</div>
                  <select
                    className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
                    value={idType}
                    onChange={(e) => setIdType(e.target.value)}
                    required
                  >
                    <option value="">Select…</option>
                    {["National ID", "Voter’s Card", "Driver’s License", "International Passport"].map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>

                <div>
                  <div className="text-sm text-zinc-300 mb-1">Government ID image *</div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                      placeholder="ID Image URL"
                      value={idUrl}
                      onChange={(e) => setIdUrl(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
                      onClick={() => openUpload(setIdUrl, "kpocha/client-kyc")}
                    >
                      Upload
                    </button>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <div className="text-sm text-zinc-300 mb-1">Take a selfie *</div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                      placeholder="Selfie Image URL"
                      value={selfieWithIdUrl}
                      onChange={(e) => setSelfieWithIdUrl(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
                      onClick={() => openUpload(setSelfieWithIdUrl, "kpocha/client-kyc")}
                    >
                      Upload
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Agreements */}
          <div className="rounded border border-zinc-800 p-3 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={agreements.terms}
                onChange={() => setAgreements((p) => ({ ...p, terms: !p.terms }))}
              />
              <span>
                I agree to the{" "}
                <a href="/legal#terms" target="_blank" rel="noreferrer" className="text-gold underline">
                  Terms &amp; Conditions
                </a>
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={agreements.privacy}
                onChange={() => setAgreements((p) => ({ ...p, privacy: !p.privacy }))}
              />
              <span>
                I agree to the{" "}
                <a href="/legal#privacy" target="_blank" rel="noreferrer" className="text-gold underline">
                  Privacy Policy
                </a>
              </span>
            </label>
          </div>

          {/* Nearby pros */}
          <div className="rounded border border-zinc-800 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-zinc-300">See Professionals near your current location</div>
              <button
                type="button"
                onClick={loadNearby}
                disabled={nearbyBusy}
                className="text-sm px-3 py-1.5 rounded border border-gold text-gold hover:bg-yellow-900/20 disabled:opacity-60"
                title="Uses /api/barbers/nearby"
              >
                {nearbyBusy ? "Finding…" : "See nearby"}
              </button>
            </div>

            {!!nearby.length && (
              <ul className="mt-3 space-y-2">
                {nearby.slice(0, 6).map((b) => (
                  <li
                    key={b.id || b._id || b.proId || `${b.name}-${b.lga}-${b.distanceKm || 0}`}
                    className="text-sm flex justify-between border border-zinc-800 rounded px-2 py-1"
                  >
                    <span>{b.name || b.proName || "Professional"}</span>
                    <span className="text-zinc-400">
                      {b.distanceKm != null ? `${b.distanceKm} km` : b.lga || ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Save */}
          <div className="flex justify-end">
            <button
              disabled={!canSave}
              onClick={save}
              className="px-4 py-2 rounded-lg bg-gold text-black font-semibold disabled:opacity-50"
            >
              Save &amp; Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Small input helper */
function Input({ label, required, ...props }) {
  return (
    <label className="block">
      <div className="text-sm text-zinc-300 mb-1">
        {label}
        {required ? " *" : ""}
      </div>
      <input {...props} className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2" />
    </label>
  );
}
