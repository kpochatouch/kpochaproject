// apps/web/src/pages/ClientRegister.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, getClientProfile, updateClientProfile } from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import PhoneOTP from "../components/PhoneOTP.jsx";

// same env as BecomePro
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "";

/* ---------- Cloudinary widget (same pattern as BecomePro) ---------- */
function useCloudinaryWidget() {
  const [ready, setReady] = useState(!!window.cloudinary?.createUploadWidget);

  useEffect(() => {
    if (ready) return;
    if (!document.querySelector('script[data-cld="1"]')) {
      const s = document.createElement("script");
      s.src = "https://widget.cloudinary.com/v2.0/global/all.js";
      s.async = true;
      s.defer = true;
      s.setAttribute("data-cld", "1");
      s.onload = () => setReady(!!window.cloudinary?.createUploadWidget);
      document.body.appendChild(s);
    }
    const t = setInterval(() => {
      if (window.cloudinary?.createUploadWidget) {
        setReady(true);
        clearInterval(t);
      }
    }, 200);
    const stopAfter = setTimeout(() => clearInterval(t), 10000);
    return () => {
      clearInterval(t);
      clearTimeout(stopAfter);
    };
  }, [ready]);

  const factory = (onSuccess, folder = "kpocha/clients") => {
    if (!ready || !CLOUD_NAME || !UPLOAD_PRESET) return null;
    try {
      return window.cloudinary.createUploadWidget(
        {
          cloudName: CLOUD_NAME,
          uploadPreset: UPLOAD_PRESET,
          multiple: false,
          maxFiles: 1,
          clientAllowedFormats: ["jpg", "jpeg", "png", "webp"],
          maxImageFileSize: 5 * 1024 * 1024,
          sources: ["local", "camera", "url"],
          showPoweredBy: false,
          folder,
        },
        (err, res) => {
          if (!err && res && res.event === "success") {
            onSuccess(res.info.secure_url);
          }
        }
      );
    } catch {
      return null;
    }
  };

  return { ready, factory };
}

/* ======================= Client Register Page ======================= */
export default function ClientRegister() {
  const nav = useNavigate();
  const { ready: widgetReady, factory: widgetFactory } = useCloudinaryWidget();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // core fields
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState(null);

  const [stateVal, setStateVal] = useState("");
  const [lga, setLga] = useState("");
  const [address, setAddress] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  // optional KYC
  const [verifyNow, setVerifyNow] = useState(false);
  const [idType, setIdType] = useState("");
  const [idUrl, setIdUrl] = useState("");
  const [selfieWithIdUrl, setSelfieWithIdUrl] = useState("");

  // agreements
  const [agreements, setAgreements] = useState({ terms: false, privacy: false });

  // location
  const [locLoading, setLocLoading] = useState(false);
  const [lat, setLat] = useState(null);
  const [lon, setLon] = useState(null);

  // nearby
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [nearby, setNearby] = useState([]);

  const okTimerRef = useRef(null);
  function flashOK(msg) {
    setOk(msg);
    clearTimeout(okTimerRef.current);
    okTimerRef.current = setTimeout(() => setOk(""), 2200);
  }

  // ===== Prefill =====
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

  // ===== Can save? =====
  const canSave = useMemo(() => {
    const base = !!fullName && !!phone && (!!stateVal || !!lga) && !!address;
    const agreed = agreements.terms && agreements.privacy;
    if (!verifyNow) return base && agreed;
    return base && agreed && !!idType && !!idUrl && !!selfieWithIdUrl;
  }, [fullName, phone, stateVal, lga, address, verifyNow, idType, idUrl, selfieWithIdUrl, agreements]);

  // ===== Save =====
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
      await updateClientProfile(payload);
      flashOK("Saved!");
      nav("/browse", { replace: true });
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to save.");
    }
  }

  // ===== Use my location =====
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
          ? "Location requires HTTPS. Use your ngrok URL on phone, or localhost on laptop."
          : "Could not get your location. Please allow location."
      );
    } finally {
      setLocLoading(false);
    }
  }

  // ===== Nearby =====
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
      {/* match BecomePro header style */}
      <h1 className="text-2xl font-semibold mb-6 text-yellow-400">Client Profile</h1>

      {err && (
        <div className="mb-4 rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">
          {err}
        </div>
      )}
      {ok && (
        <div className="mb-4 rounded border border-emerald-700 bg-emerald-900/30 text-emerald-100 px-3 py-2">
          {ok}
        </div>
      )}

      {loading ? (
        <div className="text-zinc-200">Loading…</div>
      ) : (
        <div className="space-y-6">
          {/* Avatar (like BecomePro UploadRow but as circle) */}
          <Section title="Photo">
            <div className="flex items-center gap-4">
              <div className="relative w-16 h-16 rounded-full border border-yellow-500/60 overflow-hidden bg-zinc-900">
                {photoUrl ? (
                  <img src={photoUrl} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500">
                    No Photo
                  </div>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <input
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200"
                  placeholder="Photo URL"
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                />
                <UploadButton
                  title={widgetReady ? "Upload" : "Upload (loading…)"}
                  onUploaded={(url) => setPhotoUrl(url)}
                  widgetFactory={widgetFactory}
                  disabled={!widgetReady || !CLOUD_NAME || !UPLOAD_PRESET}
                  folder="kpocha/clients"
                />
                {photoUrl && (
                  <button
                    type="button"
                    onClick={() => setPhotoUrl("")}
                    className="px-3 py-1.5 rounded-lg border border-red-500/60 text-red-200 text-sm hover:bg-red-500/10"
                  >
                    Remove
                  </button>
                )}
              </div>
              {(!CLOUD_NAME || !UPLOAD_PRESET) && (
                <p className="text-xs text-zinc-500">Upload widget not configured — use URL.</p>
              )}
            </div>
          </Section>

          {/* Basic Info */}
          <Section title="Basic Information">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Full name *"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
              <div>
                <Input
                  label={`Phone${phoneVerifiedAt ? " (verified)" : ""} *`}
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setPhoneVerifiedAt(null);
                  }}
                />
                <PhoneOTP phone={phone} disabled={!phone} onVerified={(iso) => setPhoneVerifiedAt(iso)} />
              </div>
            </div>
          </Section>

          {/* Location */}
          <Section title="Location">
            <label className="block text-sm text-yellow-300 mb-1">State &amp; LGA</label>
            <NgGeoPicker
              valueState={stateVal}
              onChangeState={setStateVal}
              valueLga={lga}
              onChangeLga={setLga}
              required
              className="grid grid-cols-1 gap-3"
            />

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input
                label="Address / Landmark *"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <Input
                label="Latitude (optional)"
                value={lat ?? ""}
                onChange={(e) => setLat(e.target.value)}
                placeholder="6.5244"
              />
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={useMyLocation}
                  disabled={locLoading}
                  className="w-full px-3 py-2 rounded-lg border border-yellow-500 text-yellow-300 text-sm hover:bg-yellow-500/10 disabled:opacity-60"
                >
                  {locLoading ? "Detecting…" : "Use my location"}
                </button>
              </div>
            </div>
          </Section>

          {/* KYC */}
          <Section title="Optional Verification (KYC)">
            <label className="flex items-center gap-2 text-sm text-yellow-200 mb-3">
              <input
                type="checkbox"
                checked={verifyNow}
                onChange={(e) => setVerifyNow(e.target.checked)}
              />
              Verify my identity now (recommended)
            </label>

            {verifyNow && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>ID Type *</Label>
                  <select
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
                    value={idType}
                    onChange={(e) => setIdType(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {["National ID", "Voter’s Card", "Driver’s License", "International Passport"].map(
                      (o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <UploadRow
                  label="Government ID image *"
                  value={idUrl}
                  onChange={setIdUrl}
                  widgetFactory={widgetFactory}
                  widgetReady={widgetReady}
                  folder="kpocha/client-kyc"
                />

                <UploadRow
                  label="Selfie with ID *"
                  value={selfieWithIdUrl}
                  onChange={setSelfieWithIdUrl}
                  widgetFactory={widgetFactory}
                  widgetReady={widgetReady}
                  folder="kpocha/client-kyc"
                  className="md:col-span-2"
                />
              </div>
            )}
          </Section>

          {/* Agreements */}
          <Section title="Agreements">
            <div className="space-y-2 text-sm text-yellow-200">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={agreements.terms}
                  onChange={() => setAgreements((p) => ({ ...p, terms: !p.terms }))}
                />
                <span>
                  I agree to the{" "}
                  <Link to="/legal#terms" target="_blank" rel="noreferrer" className="underline">
                    Terms &amp; Conditions
                  </Link>
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
                  <Link to="/legal#privacy" target="_blank" rel="noreferrer" className="underline">
                    Privacy Policy
                  </Link>
                </span>
              </label>
            </div>
          </Section>

          {/* Nearby */}
          <Section title="Professionals near you">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-200">Find stylists/barbers within 25km.</p>
              <button
                type="button"
                onClick={loadNearby}
                disabled={nearbyBusy}
                className="text-sm px-3 py-1.5 rounded-lg border border-yellow-500 text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-60"
              >
                {nearbyBusy ? "Finding…" : "See nearby"}
              </button>
            </div>

            {!!nearby.length && (
              <ul className="mt-3 space-y-2">
                {nearby.slice(0, 6).map((b) => (
                  <li
                    key={b.id || b._id || b.proId || `${b.name}-${b.lga}-${b.distanceKm || 0}`}
                    className="flex justify-between items-center border border-zinc-800 rounded px-2 py-1 text-sm"
                  >
                    <span>{b.name || b.proName || "Professional"}</span>
                    <span className="text-zinc-400">
                      {b.distanceKm != null ? `${b.distanceKm} km` : b.lga || ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Save */}
          <button
            disabled={!canSave}
            onClick={save}
            className="w-full bg-yellow-400 text-black font-semibold rounded-lg py-2 disabled:opacity-60"
          >
            Save &amp; Continue
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Small UI (copied style from BecomePro) ---------- */
function Section({ title, children }) {
  return (
    <section className="rounded-lg border border-yellow-500/40 p-4 bg-black">
      <h3 className="font-semibold mb-3 text-yellow-400">{title}</h3>
      {children}
    </section>
  );
}

function Label({ children }) {
  return <div className="text-sm text-yellow-300 mb-1">{children}</div>;
}

function Input({ label, ...props }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input
        {...props}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
      />
    </label>
  );
}

function UploadButton({ title = "Upload", onUploaded, widgetFactory, disabled, folder }) {
  function open() {
    const widget = widgetFactory?.(onUploaded, folder);
    if (!widget) {
      alert("Upload unavailable. Enter a URL manually.");
      return;
    }
    widget.open();
  }
  return (
    <button
      type="button"
      onClick={open}
      disabled={disabled}
      className="px-3 py-1.5 rounded-lg border border-yellow-500 text-yellow-300 text-sm hover:bg-yellow-500/10 disabled:opacity-50"
    >
      {title}
    </button>
  );
}

function UploadRow({
  label,
  value,
  onChange,
  widgetFactory,
  widgetReady,
  folder,
  className = "",
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200"
          placeholder="Paste image URL"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <UploadButton
          title={widgetReady ? "Upload" : "Upload (loading…)"}
          onUploaded={(url) => onChange(url)}
          widgetFactory={widgetFactory}
          disabled={!widgetReady || !CLOUD_NAME || !UPLOAD_PRESET}
          folder={folder}
        />
      </div>
      {(!CLOUD_NAME || !UPLOAD_PRESET) && (
        <p className="text-xs text-zinc-500 mt-1">
          Upload widget not configured — the URL field is the fallback.
        </p>
      )}
    </div>
  );
}
