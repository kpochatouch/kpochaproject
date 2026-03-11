// apps/web/src/pages/ClientRegister.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  api,
  getClientProfile,
  updateClientProfile,
  ensureClientProfile,
} from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import MediaUploader from "../components/MediaUploader.jsx";
import FaceEnrollModal from "../components/FaceEnrollModal.jsx";
import { getSignedMediaUrl } from "../lib/r2Upload";

/* ---------- Client face-gate pipeline keys ---------- */
const CLIENT_REGISTER_PENDING_KEY = "kpocha:clientRegisterPending";
const AFTER_LIVENESS_KEY = "kpocha:afterLiveness";
const CLIENT_REGISTER_ENROLLED_ASSET_KEY =
  "kpocha:clientRegisterEnrolledAssetId";

function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function lsDel(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

/* ======================= Client Register Page ======================= */
export default function ClientRegister() {
  const nav = useNavigate();
  const [params] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pipelineStarted, setPipelineStarted] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // core fields
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  // we keep state as returned by the API (proper casing) so NgGeoPicker can match it
  const [stateVal, setStateVal] = useState("");
  const [lga, setLga] = useState("");
  const [address, setAddress] = useState("");
  const [photoAssetId, setPhotoAssetId] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");

  // client face gate (backend truth)
  const [faceGate, setFaceGate] = useState({
    enrolledAssetId: "",
    enrolledAt: null,
    lastVerifiedAt: null,
    lastCheckedAt: null,
    lastSimilarity: 0,
    lastSessionId: "",
    lastReason: "",
    lastStatus: "",
    livenessVerifiedAt: null,
  });

  // private selfie for face enroll
  const [enrollSelfie, setEnrollSelfie] = useState({
    assetId: "",
    previewUrl: "",
  });
  const [needEnrollSelfie, setNeedEnrollSelfie] = useState(false);

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

  function applyProfileData(data) {
    if (!data) return;

    setFullName(data.fullName || "");
    setPhone(data.phone || "");
    setStateVal(data.state || "");
    setLga((data.lga || "").toString().toUpperCase());
    setAddress(data.address || "");
    setPhotoAssetId(data.photoAssetId || data?.identity?.photoAssetId || "");

    if (data.lat != null) setLat(data.lat);
    if (data.lon != null) setLon(data.lon);

    const acceptedTerms = !!data.acceptedTerms || !!data?.agreements?.terms;
    const acceptedPrivacy =
      !!data.acceptedPrivacy || !!data?.agreements?.privacy;

    if (acceptedTerms || acceptedPrivacy) {
      setAgreements({
        terms: acceptedTerms,
        privacy: acceptedPrivacy,
      });
    }

    setFaceGate({
      enrolledAssetId: data?.face?.enrolledAssetId || "",
      enrolledAt: data?.face?.enrolledAt || null,
      lastVerifiedAt: data?.face?.lastVerifiedAt || null,
      lastCheckedAt: data?.face?.lastCheckedAt || null,
      lastSimilarity: Number(data?.face?.lastSimilarity || 0),
      lastSessionId:
        data?.face?.lastSessionId || data?.liveness?.lastSessionId || "",
      lastReason: data?.face?.lastReason || "",
      lastStatus: data?.face?.lastStatus || "",
      livenessVerifiedAt:
        data?.livenessVerifiedAt || data?.liveness?.lastVerifiedAt || null,
    });
  }

  async function resolvePreviewUrl(assetId, variant = "original") {
    const id = String(assetId || "").trim();
    if (!id) return "";
    try {
      return await getSignedMediaUrl({ api, assetId: id, variant });
    } catch {
      return "";
    }
  }

  function buildPayload() {
    const latClean = lat === "" || lat === null ? null : Number(lat);
    const lonClean = lon === "" || lon === null ? null : Number(lon);

    const stateUP = (stateVal || "").toString().toUpperCase().trim();
    const lgaUP = (lga || stateVal || "").toString().toUpperCase().trim();

    const payload = {
      fullName: fullName?.trim(),
      phone: phone?.trim(),
      state: stateUP,
      lga: lgaUP,
      address: address?.trim(),
      photoAssetId,
      acceptedTerms: !!agreements.terms,
      acceptedPrivacy: !!agreements.privacy,
      agreements: {
        terms: !!agreements.terms,
        privacy: !!agreements.privacy,
      },
      identity: {
        phone: phone?.trim(),
        state: stateUP,
        city: lgaUP,
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

    return payload;
  }

  const canProceedBase = useMemo(() => {
    return (
      !!fullName &&
      !!phone &&
      (!!stateVal || !!lga) &&
      !!address &&
      !!photoAssetId &&
      agreements.terms &&
      agreements.privacy
    );
  }, [fullName, phone, stateVal, lga, address, photoAssetId, agreements]);

  const isVerified = useMemo(() => {
    return (
      !!faceGate.enrolledAssetId &&
      !!faceGate.livenessVerifiedAt &&
      faceGate.lastStatus === "match" &&
      !!faceGate.lastVerifiedAt
    );
  }, [faceGate]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr("");

      try {
        await ensureClientProfile();
        const data = await getClientProfile().catch(() => null);
        if (!alive) return;

        if (data) {
          applyProfileData(data);
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
    let cancelled = false;

    (async () => {
      const url = await resolvePreviewUrl(photoAssetId);
      if (!cancelled) setPhotoPreviewUrl(url || "");
    })();

    return () => {
      cancelled = true;
    };
  }, [photoAssetId]);

  useEffect(() => {
    const auto = params.get("auto");
    if (auto !== "1") return;

    let alive = true;

    (async () => {
      try {
        setBusy(true);
        setErr("");
        setOk("");

        const pending = lsGet(CLIENT_REGISTER_PENDING_KEY);
        const enrolledAssetId = String(
          lsGet(CLIENT_REGISTER_ENROLLED_ASSET_KEY) || "",
        ).trim();

        if (!pending) {
          setErr("Could not resume face verification. Please try again.");
          return;
        }

        if (!enrolledAssetId) {
          setErr("Missing enrolled selfie. Please try again.");
          return;
        }

        await api.post("/api/face/enroll", { enrolledAssetId });
        await updateClientProfile(pending);

        const fresh = await getClientProfile().catch(() => null);
        if (!alive) return;

        if (fresh) {
          applyProfileData(fresh);
        }

        lsDel(CLIENT_REGISTER_PENDING_KEY);
        lsDel(CLIENT_REGISTER_ENROLLED_ASSET_KEY);

        flashOK("Saved!");
        nav("/browse", { replace: true });
        setPipelineStarted(false);
      } catch (e) {
        if (!alive) return;
        setErr(
          e?.response?.data?.message ||
            e?.response?.data?.error ||
            "Face verification failed. Please retry.",
        );
        setPipelineStarted(false);
      } finally {
        if (alive) setBusy(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [params, nav]);

  async function startClientFaceGate() {
    if (busy || pipelineStarted) return;

    if (!canProceedBase) {
      setErr("Please complete all required fields.");
      return;
    }

    const enrolledAssetId = String(
      faceGate.enrolledAssetId || enrollSelfie.assetId || "",
    ).trim();

    if (!enrolledAssetId) {
      setErr("");
      setNeedEnrollSelfie(true);
      return;
    }

    setPipelineStarted(true);
    setBusy(true);
    setErr("");

    try {
      const payload = buildPayload();

      lsSet(CLIENT_REGISTER_PENDING_KEY, payload);
      lsSet(CLIENT_REGISTER_ENROLLED_ASSET_KEY, enrolledAssetId);
      lsSet(AFTER_LIVENESS_KEY, {
        next: "/client/register?auto=1",
        reason: "client_onboarding",
      });

      nav(`/aws-liveness?back=${encodeURIComponent("/client/register")}`);
    } catch (e) {
      setErr("Could not continue. Please try again.");
      setPipelineStarted(false);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy) return;

    try {
      setErr("");

      if (!canProceedBase) {
        setErr("Please complete all required fields.");
        return;
      }

      if (!isVerified) {
        await startClientFaceGate();
        return;
      }

      setBusy(true);

      const payload = buildPayload();
      await updateClientProfile(payload);

      const fresh = await getClientProfile().catch(() => null);
      if (fresh) {
        applyProfileData(fresh);
      }

      flashOK("Saved!");
      nav("/browse", { replace: true });
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to save profile.");
    } finally {
      setBusy(false);
    }
  }

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
        Client Register
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

      <FaceEnrollModal
        open={needEnrollSelfie}
        api={api}
        busy={busy}
        title="Take a quick selfie"
        subtitle="Center your face clearly and continue."
        selfie={enrollSelfie}
        onChangeSelfie={({ previewUrl, assetId }) =>
          setEnrollSelfie((prev) => {
            try {
              if (prev.previewUrl?.startsWith("blob:")) {
                URL.revokeObjectURL(prev.previewUrl);
              }
            } catch {}
            return { assetId: assetId || "", previewUrl: previewUrl || "" };
          })
        }
        onContinue={async () => {
          setNeedEnrollSelfie(false);
          await startClientFaceGate();
        }}
        onCancel={() => setNeedEnrollSelfie(false)}
      />

      {loading ? (
        <div className="text-zinc-200">Loading…</div>
      ) : (
        <div className="space-y-6">
          {/* Photo */}
          <Section title="Photo">
            <div className="flex flex-wrap items-center gap-4">
              <MediaUploader
                api={api}
                type="image"
                visibility="private"
                valueUrl={photoPreviewUrl}
                valueAssetId={photoAssetId}
                onChange={({ previewUrl, assetId }) => {
                  setPhotoPreviewUrl(previewUrl || "");
                  setPhotoAssetId(assetId || "");
                  flashOK("Uploaded ✓");
                }}
                label="Upload Photo"
              />

              {isVerified ? (
                <span className="text-xs text-emerald-400 font-medium">
                  Verified ✓
                </span>
              ) : null}
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

          <button
            disabled={busy || !canProceedBase}
            onClick={save}
            className="w-full bg-yellow-400 text-black font-semibold rounded-lg py-2 disabled:opacity-60"
          >
            {busy ? "Working..." : "Save & Continue"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Small UI ---------- */
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
