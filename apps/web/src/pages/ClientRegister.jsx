import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";

/* ===== Cloudinary helpers (signed first, unsigned fallback) ===== */
const CLOUD =
  import.meta.env.VITE_CLOUDINARY_CLOUD ||
  import.meta.env.VITE_CLOUDINARY_CLOUD_NAME ||
  "";
const PRESET =
  import.meta.env.VITE_CLOUDINARY_UNSIGNED_PRESET ||
  import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET ||
  "";

// tiny uploader used by the standalone camera + liveness
async function uploadToCloudinary(file, { folder = "kpocha/clients" } = {}) {
  try {
    const { data } = await api.post("/api/uploads/sign", { folder });
    if (data?.signature && data?.apiKey && data?.timestamp && data?.cloudName) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", data.apiKey);
      fd.append("timestamp", data.timestamp);
      fd.append("signature", data.signature);
      fd.append("folder", data.folder || folder);
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${data.cloudName}/auto/upload`,
        { method: "POST", body: fd }
      );
      const json = await res.json();
      if (!res.ok || !json.secure_url)
        throw new Error(json.error?.message || "Upload failed");
      return json.secure_url;
    }
  } catch {
    /* fall back */
  }

  if (!CLOUD || !PRESET) throw new Error("Cloudinary env missing.");
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", PRESET);
  fd.append("folder", folder);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD}/auto/upload`,
    { method: "POST", body: fd }
  );
  const json = await res.json();
  if (!res.ok || !json.secure_url)
    throw new Error(json.error?.message || "Upload failed");
  return json.secure_url;
}

/* ===== A very small camera modal (backup capture) ===== */
function CameraCaptureButton({ label = "Camera", folder = "kpocha/clients", onUploaded }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  return (
    <>
      <button
        type="button"
        className="px-3 py-2 rounded border border-zinc-700 text-sm hover:bg-zinc-900"
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && (
        <CameraShotModal
          folder={folder}
          onClose={() => setOpen(false)}
          onError={(m) => setErr(m)}
          onUploaded={(u) => {
            onUploaded?.(u);
            setOpen(false);
          }}
        />
      )}
      {err && <div className="text-[11px] text-red-400">{err}</div>}
    </>
  );
}
function CameraShotModal({ onClose, onUploaded, onError, folder }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
        }
      } catch {
        onError?.("Camera not available.");
      }
    })();
    return () => {
      stream?.getTracks()?.forEach((t) => t.stop());
    };
  }, [onError]);
  async function capture() {
    try {
      setBusy(true);
      const v = videoRef.current,
        c = canvasRef.current;
      if (!v || !c) throw new Error("Camera not ready.");
      c.width = v.videoWidth || 1280;
      c.height = v.videoHeight || 720;
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
      const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
      const url = await uploadToCloudinary(file, { folder });
      onUploaded?.(url);
    } catch (e) {
      onError?.(e?.message || "Capture failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-[min(92vw,720px)]">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full rounded-lg bg-black aspect-video"
        />
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={capture}
            className="px-3 py-2 rounded bg-[#d4af37] text-black font-semibold disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Saving…" : "Capture"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded border border-zinc-700"
          >
            Close
          </button>
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}

/* ===== Lightweight liveness (non-mandatory) ===== */
function LivenessCapture({ onUploaded, folder = "kpocha/clients/liveness" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [url, setUrl] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-3 py-2 rounded border border-zinc-700 hover:bg-zinc-900"
          onClick={() => setOpen(true)}
        >
          Start liveness (optional)
        </button>
        {url && <span className="text-xs text-emerald-400">Saved ✓</span>}
      </div>
      {open && (
        <LivenessModal
          folder={folder}
          onClose={() => setOpen(false)}
          onBusy={setBusy}
          onError={(m) => setErr(m)}
          onUploaded={(u) => {
            setUrl(u);
            onUploaded?.(u);
            setOpen(false);
          }}
        />
      )}
      {busy && <div className="text-xs text-zinc-400">Uploading…</div>}
      {err && <div className="text-xs text-red-400">{err}</div>}
    </div>
  );
}
function LivenessModal({ onClose, onUploaded, onError, onBusy, folder }) {
  const videoRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    let stream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 720 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.onloadedmetadata = () => videoRef.current?.play?.();
        }
      } catch {
        onError?.("Camera access failed. Use HTTPS and allow camera.");
      }
    })();
    return () => {
      stream?.getTracks()?.forEach((t) => t.stop());
    };
  }, [onError]);

  function startRecording() {
    const hasMR = typeof window !== "undefined" && "MediaRecorder" in window;
    if (!hasMR) {
      onError?.("Recording not supported in this browser.");
      return;
    }
    const stream = streamRef.current;
    if (!stream) return;

    const mr = window.MediaRecorder;
    const mime =
      (mr.isTypeSupported?.("video/webm;codecs=vp9") && "video/webm;codecs=vp9") ||
      (mr.isTypeSupported?.("video/webm") && "video/webm") ||
      (mr.isTypeSupported?.("video/mp4") && "video/mp4") ||
      "";

    const rec = new mr(stream, mime ? { mimeType: mime } : undefined);
    recRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = async () => {
      try {
        onBusy?.(true);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "video/webm" });
        const file = new File([blob], "liveness.webm", { type: blob.type });
        const url = await uploadToCloudinary(file, { folder });
        onUploaded?.(url);
      } catch (e) {
        onError?.(e.message || "Upload failed");
      } finally {
        onBusy?.(false);
      }
    };
    rec.start();
    setRecording(true);
  }
  function stopRecordingAndUpload() {
    try {
      recRef.current?.stop?.();
    } catch {}
    setRecording(false);
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-[min(92vw,560px)]">
        <div className="text-sm text-zinc-400 mb-2">
          Look straight, turn right, turn left, blink twice. (Lightweight mode — not strict.)
        </div>
        <video ref={videoRef} playsInline muted autoPlay className="w-full rounded-lg bg-black aspect-video" />
        <div className="mt-3 flex items-center justify-between">
          {!recording ? (
            <button type="button" onClick={startRecording} className="px-3 py-2 rounded bg-[#d4af37] text-black font-semibold">
              Start
            </button>
          ) : (
            <button type="button" onClick={stopRecordingAndUpload} className="px-3 py-2 rounded bg-[#d4af37] text-black font-semibold">
              Finish
            </button>
          )}
          <button type="button" onClick={onClose} className="px-3 py-2 rounded border border-zinc-700">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===== Main page ===== */
export default function ClientRegister() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);

  // friendly error and an optional raw payload for debugging
  const [err, setErr] = useState("");
  const [errDetails, setErrDetails] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const [ok, setOk] = useState("");

  // basics
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const [stateVal, setStateVal] = useState("");
  const [lga, setLga] = useState("");
  const [address, setAddress] = useState(""); // will be saved as houseAddress
  const [photoUrl, setPhotoUrl] = useState("");

  // optional KYC
  const [verifyNow, setVerifyNow] = useState(false);
  const [idType, setIdType] = useState("");
  const [idUrl, setIdUrl] = useState("");
  const [selfieWithIdUrl, setSelfieWithIdUrl] = useState("");
  const [livenessUrl, setLivenessUrl] = useState("");

  // agreements
  const [agreements, setAgreements] = useState({ terms: false, privacy: false });

  // location helpers
  const [locLoading, setLocLoading] = useState(false);
  const [lat, setLat] = useState(null);
  const [lon, setLon] = useState(null);

  const okTimerRef = useRef(null);
  function flashOK(msg) {
    setOk(msg);
    clearTimeout(okTimerRef.current);
    okTimerRef.current = setTimeout(() => setOk(""), 2200);
  }

  // Load existing profile + seed from /api/me (signup details)
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      setErrDetails(null);
      try {
        const [{ data: me }, { data: existing }] = await Promise.all([
          api.get("/api/me").catch(() => ({ data: null })),
          api.get("/api/profile/client/me").catch(() => ({ data: null })),
        ]);

        if (!alive) return;

        // seed from server profile when present
        if (existing) {
          setFullName(existing.fullName || "");
          setPhone(existing.phone || "");
          setStateVal(existing.state || "");
          setLga((existing.lga || "").toString().toUpperCase());
          setAddress(existing.houseAddress || existing.address || "");
          setPhotoUrl(existing.photoUrl || "");
          if (existing.lat != null) setLat(existing.lat);
          if (existing.lon != null) setLon(existing.lon);

          const acceptedTerms =
            !!existing.acceptedTerms || !!existing?.agreements?.terms;
          const acceptedPrivacy =
            !!existing.acceptedPrivacy || !!existing?.agreements?.privacy;
          if (acceptedTerms || acceptedPrivacy)
            setAgreements({ terms: acceptedTerms, privacy: acceptedPrivacy });

          const k = existing.kyc || {};
          if (k?.idType || k?.idUrl || k?.selfieWithIdUrl) {
            setVerifyNow(true);
            setIdType(k.idType || "");
            setIdUrl(k.idUrl || "");
            setSelfieWithIdUrl(k.selfieWithIdUrl || "");
          }
        } else if (me) {
          // otherwise prefill from signup details
          setFullName((p) => p || me.displayName || "");
          setPhone((p) => p || me.phone || "");
          setPhotoUrl((p) => p || me.photoUrl || "");
        }
      } catch (e) {
        if (alive) {
          setErr("Unable to load your profile.");
          setErrDetails(e?.response?.data || e?.message || null);
        }
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
    const base =
      !!fullName &&
      !!phone &&
      (!!stateVal || !!lga) &&
      !!address &&
      agreements.terms &&
      agreements.privacy;
    if (!verifyNow) return base;
    return base && !!idType && !!idUrl && !!selfieWithIdUrl; // liveness optional
  }, [
    fullName,
    phone,
    stateVal,
    lga,
    address,
    verifyNow,
    idType,
    idUrl,
    selfieWithIdUrl,
    agreements,
  ]);

  /** Build a human message listing missing fields (for instant feedback) */
  function getMissing() {
    const missing = [];
    if (!fullName) missing.push("Full name");
    if (!phone) missing.push("Phone");
    if (!stateVal && !lga) missing.push("State or LGA");
    if (!address) missing.push("Address / Landmark");
    if (!agreements.terms) missing.push("Agree to Terms");
    if (!agreements.privacy) missing.push("Agree to Privacy");
    if (verifyNow) {
      if (!idType) missing.push("ID Type");
      if (!idUrl) missing.push("Government ID image");
      if (!selfieWithIdUrl) missing.push("Selfie");
    }
    return missing;
  }

  function friendlyFromAxios(e) {
    // Network/CORS
    if (e?.code === "ERR_NETWORK") return "Network error. Check internet or CORS.";
    const status = e?.response?.status;
    const apiPath = e?.config?.url || "";
    if (status === 401) return "You’re signed out or your session expired. Please sign in, then try again.";
    if (status === 403) return "You don’t have permission to perform this action.";
    if (status === 404) return `Endpoint not found (${apiPath}).`;
    if (status === 422) return "Some fields are invalid. See details below.";
    if (status === 429) return "Too many requests. Please slow down and try again.";
    if (status === 503) return "The server’s database is not available right now. Please try again shortly.";
    if (status >= 500) return "Server error while saving. Please try again.";
    return e?.response?.data?.message || e?.response?.data?.error || e?.message || "Failed to save.";
  }

  async function save() {
    try {
      setErr("");
      setErrDetails(null);
      const missing = getMissing();
      if (missing.length) {
        setErr(`Please complete: ${missing.join(", ")}.`);
        return;
      }

      const payload = {
        fullName,
        phone,
        state: stateVal,
        lga: (lga || stateVal || "").toString().toUpperCase(),
        houseAddress: address, // <-- unified key
        photoUrl,
        ...(lat != null && lon != null ? { lat, lon } : {}),
        acceptedTerms: !!agreements.terms,
        acceptedPrivacy: !!agreements.privacy,
        agreements: {
          terms: !!agreements.terms,
          privacy: !!agreements.privacy,
        },
      };

      if (verifyNow) {
        payload.kyc = {
          idType,
          idUrl,
          selfieWithIdUrl,
          livenessUrl: livenessUrl || undefined, // optional
          status: "pending",
        };
      }

      await api.put("/api/profile/client/me", payload);
      flashOK("Saved!");
      nav("/settings", { replace: true });
    } catch (e) {
      const friendly = friendlyFromAxios(e);
      setErr(friendly);
      setErrDetails({
        status: e?.response?.status ?? null,
        endpoint: e?.config?.url ?? null,
        response: e?.response?.data ?? null,
      });
      setShowDetails(true);
    }
  }

  // --- Use my location (browser geolocation -> server reverse geocode) ---
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
      const { data } = await api.get("/api/geo/rev", {
        params: { lat: theLat, lon: theLon },
      });
      const feat = data?.features?.[0];
      const p = feat?.properties || {};
      const detectedState = (p.state || p.region || "")
        .toString()
        .toUpperCase();
      const detectedLga = (
        p.county ||
        p.city ||
        p.district ||
        p.suburb ||
        ""
      )
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
          ? "Location requires HTTPS."
          : "Allow location permission."
      );
    } finally {
      setLocLoading(false);
    }
  }

  /* Cloudinary Upload Widget (nice–to–have) */
  const [widgetReady, setWidgetReady] = useState(
    !!window.cloudinary?.createUploadWidget
  );
  useEffect(() => {
    if (widgetReady) return;
    const id = "cld-global-all";
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://widget.cloudinary.com/v2.0/global/all.js";
      s.async = true;
      s.defer = true;
      s.onload = () =>
        setWidgetReady(!!window.cloudinary?.createUploadWidget);
      document.body.appendChild(s);
    } else setWidgetReady(!!window.cloudinary?.createUploadWidget);
  }, [widgetReady]);

  function openUpload(setter, folder = "kpocha/clients") {
    if (!widgetReady || !CLOUD || !PRESET) {
      alert("Upload unavailable. Use the Camera button instead.");
      return;
    }
    const w = window.cloudinary.createUploadWidget(
      {
        cloudName: CLOUD,
        uploadPreset: PRESET,
        multiple: false,
        maxFiles: 1,
        folder,
        sources: ["local", "camera"],
        clientAllowedFormats: ["jpg", "jpeg", "png", "webp"],
        maxImageFileSize: 5 * 1024 * 1024,
      },
      (err, res) => {
        if (!err && res?.event === "success") setter(res.info.secure_url);
      }
    );
    w.open();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-1">Tell us about you</h1>
      <p className="text-zinc-400 mb-4">
        Save your details once. Future bookings will be instant — no long forms.
      </p>

      {err && (
        <div className="mb-4 rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div>{err}</div>
            {errDetails && (
              <button
                type="button"
                className="text-[11px] underline decoration-dotted"
                onClick={() => setShowDetails((s) => !s)}
              >
                {showDetails ? "Hide details" : "Show details"}
              </button>
            )}
          </div>

          {/* if the server sent per-field errors (422), show them nicely */}
          {errDetails?.response?.errors && typeof errDetails.response.errors === "object" && (
            <ul className="mt-2 text-[12px] list-disc pl-5 space-y-0.5">
              {Object.entries(errDetails.response.errors).map(([k, v]) => (
                <li key={k}>
                  <span className="font-medium">{k}</span>: {String(v)}
                </li>
              ))}
            </ul>
          )}

          {showDetails && errDetails && (
            <pre className="mt-2 text-[11px] whitespace-pre-wrap break-all text-red-200/90">
              {JSON.stringify(errDetails, null, 2)}
            </pre>
          )}
        </div>
      )}
      {ok && (
        <div className="mb-4 rounded border border-green-800 bg-green-900/30 text-green-100 px-3 py-2">
          {ok}
        </div>
      )}

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
                <img
                  src={photoUrl}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-zinc-500 text-xs">
                  Add Photo
                </div>
              )}
            </button>
            <CameraCaptureButton
              label="Camera"
              folder="kpocha/clients"
              onUploaded={(u) => setPhotoUrl(u)}
            />
            {photoUrl && (
              <button
                className="text-xs text-red-300 border border-red-800 rounded px-2 py-1"
                onClick={() => setPhotoUrl("")}
              >
                Remove
              </button>
            )}
          </div>

          {/* Basic */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
            <Input
              label="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm text-zinc-300 mb-1">
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
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locLoading}
                className="text-sm px-3 py-1.5 rounded border border-emerald-600 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-60"
              >
                {locLoading ? "Detecting…" : "Use my location"}
              </button>
              <span className="text-xs text-zinc-500">
                Fills State, LGA and Address automatically.
              </span>
            </div>
          </div>

          <Input
            label="Address / Landmark"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
          />

          {/* KYC */}
          <div className="rounded border border-zinc-800 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={verifyNow}
                onChange={(e) => setVerifyNow(e.target.checked)}
              />
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
                    {[
                      "National ID",
                      "Voter’s Card",
                      "Driver’s License",
                      "International Passport",
                    ].map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>

                <div>
                  <div className="text-sm text-zinc-300 mb-1">
                    Government ID image *
                  </div>
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
                    <CameraCaptureButton
                      label="Camera"
                      folder="kpocha/client-kyc"
                      onUploaded={setIdUrl}
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <div className="text-sm text-zinc-300 mb-1">Upload a selfie *</div>
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
                      onClick={() =>
                        openUpload(setSelfieWithIdUrl, "kpocha/client-kyc")
                      }
                    >
                      Upload
                    </button>
                    <CameraCaptureButton
                      label="Camera"
                      folder="kpocha/client-kyc"
                      onUploaded={setSelfieWithIdUrl}
                    />
                  </div>
                </div>

                <div className="md:col-span-2">
                  <LivenessCapture onUploaded={setLivenessUrl} />
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
                onChange={() =>
                  setAgreements((p) => ({ ...p, terms: !p.terms }))
                }
              />
              <span>
                I agree to the{" "}
                <a
                  href="/legal#terms"
                  target="_blank"
                  rel="noreferrer"
                  className="text-gold underline"
                >
                  Terms &amp; Conditions
                </a>
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
                <a
                  href="/legal#privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-gold underline"
                >
                  Privacy Policy
                </a>
              </span>
            </label>
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

function Input({ label, required, ...props }) {
  return (
    <label className="block">
      <div className="text-sm text-zinc-300 mb-1">
        {label}
        {required ? " *" : ""}
      </div>
      <input
        {...props}
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
      />
    </label>
  );
}
