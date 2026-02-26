// apps/web/src/pages/ClientRegister.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  api,
  getClientProfile,
  updateClientProfile,
  ensureClientProfile,
} from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import { uploadMediaAsset } from "../lib/r2Upload";

/* ======================= Client Register Page ======================= */
export default function ClientRegister() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // core fields
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  // we keep state as returned by the API (proper casing) so NgGeoPicker can match it
  const [stateVal, setStateVal] = useState("");
  const [lga, setLga] = useState("");
  const [address, setAddress] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoAssetId, setPhotoAssetId] = useState("");

  // face verification (AWS liveness)
  const [verification, setVerification] = useState({
    faceVerificationVideoUrl: "",
    livenessMetrics: {},
  });

  // agreements
  const [agreements, setAgreements] = useState({
    terms: false,
    privacy: false,
  });

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

  /* ---------- Face verification storage (AWS liveness) ---------- */
  function checkVerificationStorage() {
    try {
      const metricsRaw = localStorage.getItem("kpocha:livenessMetrics");
      const videoUrl = localStorage.getItem("kpocha:livenessVideoUrl") || "";

      const hasMetrics = !!metricsRaw;
      const hasVideo = !!videoUrl;

      if (hasMetrics || hasVideo) {
        setVerification((v) => ({
          ...v,
          livenessMetrics: metricsRaw
            ? JSON.parse(metricsRaw)
            : v.livenessMetrics || {},
          faceVerificationVideoUrl:
            videoUrl || v.faceVerificationVideoUrl || "",
        }));

        // one-time consume
        localStorage.removeItem("kpocha:livenessMetrics");
        localStorage.removeItem("kpocha:livenessVideoUrl");
      }
    } catch {}
  }

  // ===== Prefill =====
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        await ensureClientProfile(); // ✅ make sure profile exists
        const data = await getClientProfile().catch(() => null);
        if (!alive) return;

        if (data) {
          setFullName(data.fullName || "");
          setPhone(data.phone || "");
          // keep original casing for UI
          setStateVal(data.state || "");
          setLga((data.lga || "").toString().toUpperCase());
          setAddress(data.address || "");
          setPhotoUrl(data.photoUrl || "");
          setPhotoAssetId(
            data.photoAssetId || data?.identity?.photoAssetId || "",
          );

          if (data.lat != null) setLat(data.lat);
          if (data.lon != null) setLon(data.lon);

          const acceptedTerms =
            !!data.acceptedTerms || !!data?.agreements?.terms;
          const acceptedPrivacy =
            !!data.acceptedPrivacy || !!data?.agreements?.privacy;
          if (acceptedTerms || acceptedPrivacy) {
            setAgreements({
              terms: acceptedTerms,
              privacy: acceptedPrivacy,
            });
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

  useEffect(() => {
    const onFocus = () => checkVerificationStorage();
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkVerificationStorage();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    // also run once on mount
    checkVerificationStorage();

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ===== Can save? =====
  const canSave = useMemo(() => {
    const base = !!fullName && !!phone && (!!stateVal || !!lga) && !!address;
    const agreed = agreements.terms && agreements.privacy;
    return base && agreed;
  }, [fullName, phone, stateVal, lga, address, agreements]);

  // ===== Save =====
  async function save() {
    try {
      setErr("");

      // sanitize lat/lon — don't send empty strings
      const latClean = lat === "" || lat === null ? null : Number(lat);
      const lonClean = lon === "" || lon === null ? null : Number(lon);

      // we send uppercase to the backend to match Pro/Profile/Browse
      const stateUP = (stateVal || "").toString().toUpperCase().trim();
      const lgaUP = (lga || stateVal || "").toString().toUpperCase().trim();

      const payload = {
        fullName: fullName?.trim(),
        phone: phone?.trim(),
        state: stateUP,
        lga: lgaUP,
        address: address?.trim(),
        photoUrl: photoUrl?.trim(),
        photoAssetId,
        acceptedTerms: !!agreements.terms,
        acceptedPrivacy: !!agreements.privacy,
        agreements: {
          terms: !!agreements.terms,
          privacy: !!agreements.privacy,
        },

        ...(verification?.faceVerificationVideoUrl ||
        Object.keys(verification?.livenessMetrics || {}).length > 0
          ? { verification }
          : {}),

        // keep identity in sync like other settings pages
        identity: {
          phone: phone?.trim(),
          state: stateUP,
          city: lgaUP,
          photoUrl: photoUrl?.trim(),
          photoAssetId,
        },
      };

      if (
        latClean != null &&
        !Number.isNaN(latClean) &&
        lonClean != null &&
        !Number.isNaN(lonClean)
      ) {
        payload.lat = latClean;
        payload.lon = lonClean;
      }

      await updateClientProfile(payload);
      flashOK("Saved!");
      nav("/browse", { replace: true });
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to save profile.");
    }
  }

  async function uploadImageToR2(file) {
    if (!file) return { url: "", assetId: "" };

    setErr("");
    flashOK("Uploading image...");

    try {
      const res = await uploadMediaAsset({
        api,
        file,
        type: "image",
      });

      if (!res?.publicUrl) {
        setErr("Upload succeeded but public URL is missing.");
        return { url: "", assetId: "" };
      }

      flashOK("Uploaded ✓");
      return {
        url: res.publicUrl,
        assetId: res.assetId || "",
      };
    } catch (e) {
      setErr(e?.message || "Upload failed.");
      return { url: "", assetId: "" };
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
        }),
      );
      const { latitude: theLat, longitude: theLon } = pos.coords;

      const { data } = await api.get("/api/geo/rev", {
        params: { lat: theLat, lon: theLon },
      });
      const feat = data?.features?.[0];
      const p = feat?.properties || {};

      const detectedState = (p.state || p.region || "")
        .toString()
        .toUpperCase();
      const detectedLga = (p.county || p.city || p.district || p.suburb || "")
        .toString()
        .toUpperCase();
      const detectedAddress = [p.address_line1, p.address_line2]
        .filter(Boolean)
        .join(", ");

      // we keep UI value as whatever we detect (usually uppercase from rev)
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
          : "Could not get your location. Please allow location.",
      );
    } finally {
      setLocLoading(false);
    }
  }

  // ===== Nearby =====
  async function loadNearby() {
    if (lat == null || lon == null) {
      alert(
        "Click ‘Use my location’ first so we can find professionals near you.",
      );
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
      <h1 className="text-2xl font-semibold mb-6 text-yellow-400">
        Client Profile
      </h1>

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
          {/* Photo */}
          <Section title="Photo">
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative w-16 h-16 rounded-full border border-yellow-500/60 overflow-hidden bg-zinc-900">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                  />
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
                <label className="px-3 py-1.5 rounded-lg border border-yellow-500 text-yellow-300 text-sm hover:bg-yellow-500/10 cursor-pointer">
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      const out = await uploadImageToR2(file);
                      if (out.url) {
                        setPhotoUrl(out.url);
                        setPhotoAssetId(out.assetId || "");
                      }
                    }}
                  />
                </label>

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

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => nav("/aws-liveness?back=/client/register")}
                  className="px-3 py-1.5 rounded-lg border border-yellow-500/80 text-yellow-200 text-sm hover:bg-yellow-500/10"
                >
                  Start Face Verification
                </button>

                {verification.faceVerificationVideoUrl ? (
                  <span className="text-xs text-emerald-400">Verified ✓</span>
                ) : (
                  <span className="text-xs text-zinc-500">
                    Not verified yet
                  </span>
                )}
              </div>
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
              <Input
                label="Phone *"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 080..."
              />
            </div>
          </Section>

          {/* Location */}
          <Section title="Location">
            <label className="block text-sm text-yellow-300 mb-1">
              State &amp; LGA
            </label>
            <NgGeoPicker
              valueState={stateVal}
              onChangeState={setStateVal}
              valueLga={lga}
              onChangeLga={setLga}
              required
              className="grid grid-cols-1 gap-3"
            />

            <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
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
              <Input
                label="Longitude (optional)"
                value={lon ?? ""}
                onChange={(e) => setLon(e.target.value)}
                placeholder="3.3792"
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

          {/* Agreements */}
          <Section title="Agreements">
            <div className="space-y-2 text-sm text-yellow-200">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={agreements.terms}
                  onChange={() =>
                    setAgreements((p) => ({ ...p, terms: !p.terms }))
                  }
                />
                <span>
                  I agree to the{" "}
                  <Link
                    to="/legal#terms"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Terms &amp; Conditions
                  </Link>
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={agreements.privacy}
                  onChange={() =>
                    setAgreements((p) => ({ ...p, privacy: !p.privacy }))
                  }
                />
                <span>
                  I agree to the{" "}
                  <Link
                    to="/legal#privacy"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Privacy Policy
                  </Link>
                </span>
              </label>
            </div>
          </Section>

          {/* Nearby */}
          <Section title="Professionals near you">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-200">
                Find Professionals within 25km.
              </p>
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
                    key={
                      b.id ||
                      b._id ||
                      b.proId ||
                      `${b.name}-${b.lga}-${b.distanceKm || 0}`
                    }
                    className="flex justify-between items-center border border-zinc-800 rounded px-2 py-1 text-sm"
                  >
                    <span>{b.name || b.proName || "Professional"}</span>
                    <span className="text-zinc-400">
                      {b.distanceKm != null
                        ? `${b.distanceKm} km`
                        : b.lga || ""}
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
