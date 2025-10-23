// apps/web/src/pages/BecomePro.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import PhoneOTP from "../components/PhoneOTP.jsx";
import SmartUpload from "../components/SmartUpload.jsx";

// ✅ Email verification helpers (Firebase)
import { auth } from "../lib/firebase";
import { sendEmailVerification, reload } from "firebase/auth";

/** ========= Cloudinary tiny helper (signed first, unsigned fallback) ========= **/
const CLOUD =
  import.meta.env.VITE_CLOUDINARY_CLOUD ||
  import.meta.env.VITE_CLOUDINARY_CLOUD_NAME ||
  "";
const PRESET =
  import.meta.env.VITE_CLOUDINARY_UNSIGNED_PRESET ||
  import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET ||
  "";

// used by LivenessCapture (webcam recorder)
async function uploadToCloudinary(file, { folder = "kpocha/pro-apps" } = {}) {
  // Try signed first (safer), fall back to unsigned preset
  try {
    const { data } = await api.post("/api/uploads/sign", { folder });
    if (data?.signature && data?.apiKey && data?.timestamp && data?.cloudName) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", data.apiKey);
      fd.append("timestamp", data.timestamp);
      fd.append("signature", data.signature);
      fd.append("folder", data.folder || folder);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${data.cloudName}/auto/upload`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.secure_url) throw new Error(json.error?.message || "Upload failed");
      return json.secure_url;
    }
  } catch {
    // ignore, try unsigned below
  }
  // Unsigned fallback
  if (!CLOUD || !PRESET) {
    const missing = [
      !CLOUD && "(cloud) VITE_CLOUDINARY_CLOUD or VITE_CLOUDINARY_CLOUD_NAME",
      !PRESET && "(preset) VITE_CLOUDINARY_UNSIGNED_PRESET or VITE_CLOUDINARY_UPLOAD_PRESET",
    ]
      .filter(Boolean)
      .join(" & ");
    throw new Error(`Cloudinary env missing: ${missing}`);
  }
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", PRESET);
  if (folder) fd.append("folder", folder);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/auto/upload`, {
    method: "POST",
    body: fd,
  });
  const json = await res.json();
  if (!res.ok || !json.secure_url) throw new Error(json.error?.message || "Upload failed");
  return json.secure_url;
}

/** ========= Field Styles ========= **/
const FIELD =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200 placeholder-zinc-500 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30";

/** ========= Quick camera buttons (always visible for iOS/Android) ========= **/
function IOSCameraButtons({ onUploaded, folder = "kpocha/pro-apps", allowVideo = false }) {
  const selfieRef = useRef(null);
  const rearRef = useRef(null);

  async function handle(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadToCloudinary(file, { folder });
      onUploaded?.(url);
    } catch (err) {
      alert(err?.message || "Upload failed");
    } finally {
      e.target.value = ""; // allow re-selecting same capture
    }
  }

  return (
    <div className="flex gap-2">
      <input
        ref={selfieRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={handle}
      />
      <input
        ref={rearRef}
        type="file"
        accept={allowVideo ? "image/*,video/*" : "image/*"}
        capture="environment"
        className="hidden"
        onChange={handle}
      />
      <button
        type="button"
        className="px-2 py-1 text-xs rounded border border-zinc-700 hover:bg-zinc-900"
        onClick={() => selfieRef.current?.click()}
        title="Open front camera"
      >
        Selfie Camera
      </button>
      <button
        type="button"
        className="px-2 py-1 text-xs rounded border border-zinc-700 hover:bg-zinc-900"
        onClick={() => rearRef.current?.click()}
        title="Open rear camera"
      >
        Rear Camera
      </button>
    </div>
  );
}

/** ========= SMART Liveness (video) with on-device checks ========= **/
/* Loads MediaPipe Tasks from CDN. Falls back to simple prompts if unavailable. */
function LivenessCapture({ onUploaded, folder = "kpocha/pro-apps/liveness" }) {
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
          Start liveness check
        </button>
        {url && <span className="text-xs text-emerald-400 truncate">Saved ✓</span>}
      </div>
      {open && (
        <LivenessModal
          folder={folder}
          onClose={() => setOpen(false)}
          onError={(m) => setErr(m)}
          onUploaded={(u) => {
            setUrl(u);
            onUploaded?.(u);
            setOpen(false);
          }}
          onBusy={setBusy}
        />
      )}
      {busy && <div className="text-xs text-zinc-400">Uploading…</div>}
      {err && <div className="text-xs text-red-400">{err}</div>}
    </div>
  );
}

/* --------- Loader for MediaPipe face landmarker (CDN, no install) --------- */
let _faceLmPromise = null;
async function loadFaceLandmarkerFromCDN() {
  if (_faceLmPromise) return _faceLmPromise;
  _faceLmPromise = new Promise((resolve, reject) => {
    if (window.FaceLandmarker && window.FilesetResolver) {
      resolve({ FaceLandmarker: window.FaceLandmarker, FilesetResolver: window.FilesetResolver });
      return;
    }
    const script = document.createElement("script");
    const ver = "0.10.0";
    script.src = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${ver}/vision_bundle.js`;
    script.async = true;
    script.onload = () => {
      if (window.FaceLandmarker && window.FilesetResolver) {
        resolve({ FaceLandmarker: window.FaceLandmarker, FilesetResolver: window.FilesetResolver, ver });
      } else {
        reject(new Error("Vision bundle loaded but APIs missing"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load vision bundle"));
    document.head.appendChild(script);
  });
  return _faceLmPromise;
}

/* -------------------- Liveness modal with AI checks -------------------- */
function LivenessModal({ onClose, onUploaded, onError, onBusy, folder }) {
  const videoRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  // AI landmarker
  const landmarkerRef = useRef(null);
  const rafRef = useRef(0);
  const [aiReady, setAiReady] = useState(false);
  const [aiFailed, setAiFailed] = useState(false);

  // Guided steps state
  const [recording, setRecording] = useState(false);
  const [step, setStep] = useState(0); // 0 straight, 1 right, 2 left, 3 blink twice, 4 done
  const [status, setStatus] = useState({ straight: false, right: false, left: false, blinks: 0 });
  const [yawDeg, setYawDeg] = useState(0);
  const lastBlinkStateRef = useRef(false);
  const rightSignRef = useRef(null);
  const straightHoldMsRef = useRef(0);
  const lastTsRef = useRef(0);

  // Simple fallback timer (used if AI fails)
  const timerRef = useRef(null);

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
          videoRef.current.muted = true;
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play?.();
          };
        }
      } catch {
        onError?.("Camera access failed. On iOS: Safari + HTTPS + allow camera.");
      }

      // Try to load AI model (best-effort)
      try {
        const { FaceLandmarker, FilesetResolver } = await loadFaceLandmarkerFromCDN();
        const wasmBase = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm";
        const filesetResolver = await FilesetResolver.forVisionTasks(wasmBase);
        const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: `${wasmBase}/face_landmarker.task`,
          },
          numFaces: 1,
          runningMode: "VIDEO",
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        landmarkerRef.current = faceLandmarker;
        setAiReady(true);
      } catch (e) {
        console.warn("[liveness] AI model load failed; using simple prompts.", e);
        setAiFailed(true);
      }
    })();

    return () => {
      stream?.getTracks()?.forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const supported =
      typeof MediaRecorder !== "undefined" &&
      typeof MediaRecorder.isTypeSupported === "function" &&
      (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : MediaRecorder.isTypeSupported("video/mp4")
        ? "video/mp4"
        : "");
    const rec = new MediaRecorder(stream, supported ? { mimeType: supported } : undefined);
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

  function begin() {
    // Start video recording
    startRecording();

    if (aiReady && landmarkerRef.current && videoRef.current) {
      // AI-driven checks
      setStep(0);
      setStatus({ straight: false, right: false, left: false, blinks: 0 });
      straightHoldMsRef.current = 0;
      lastBlinkStateRef.current = false;
      lastTsRef.current = performance.now();
      rightSignRef.current = null;
      tickAI();
    } else {
      // Fallback to timed prompts
      setStep(0);
      if (timerRef.current) clearInterval(timerRef.current);
      let i = 0;
      timerRef.current = setInterval(() => {
        i += 1;
        if (i < 4) setStep(i);
        if (i >= 6) {
          clearInterval(timerRef.current);
          stopRecordingAndUpload();
        }
      }, 2000);
    }
  }

  function getBlend(blend, name) {
    const it = (blend || []).find((c) => c.categoryName === name);
    return it ? it.score : 0;
  }

  function tickAI() {
    const faceLm = landmarkerRef.current;
    const video = videoRef.current;
    if (!faceLm || !video) return;

    const loop = () => {
      const now = performance.now();
      const res = faceLm.detectForVideo(video, now);
      if (res?.faceLandmarks?.length) {
        // yaw from transform matrix
        const mat = res.facialTransformationMatrixes?.[0]?.data || null;
        if (mat && mat.length >= 12) {
          const r20 = mat[8];
          const yaw = Math.asin(Math.max(-1, Math.min(1, -r20)));
          const yawDegrees = (yaw * 180) / Math.PI;
          setYawDeg(Math.round(yawDegrees));

          // blinks
          const blend = res.faceBlendshapes?.[0]?.categories || [];
          const bothBlink = getBlend(blend, "eyeBlinkLeft") > 0.5 && getBlend(blend, "eyeBlinkRight") > 0.5;
          if (bothBlink && !lastBlinkStateRef.current) {
            setStatus((s) => ({ ...s, blinks: Math.min(2, s.blinks + 1) }));
          }
          lastBlinkStateRef.current = bothBlink;

          // steps
          const dt = now - (lastTsRef.current || now);
          lastTsRef.current = now;
          const thrYaw = 12;
          const nearCenter = Math.abs(yawDegrees) < 8;

          setStatus((s) => {
            let next = { ...s };
            if (!next.straight) {
              if (nearCenter) {
                straightHoldMsRef.current += dt;
                if (straightHoldMsRef.current > 600) {
                  next.straight = true;
                  setStep(1);
                }
              } else {
                straightHoldMsRef.current = 0;
              }
            } else if (!next.right) {
              if (Math.abs(yawDegrees) > thrYaw) {
                rightSignRef.current = yawDegrees > 0 ? 1 : -1;
                next.right = true;
                setStep(2);
              }
            } else if (!next.left) {
              const rs = rightSignRef.current || 1;
              if (yawDegrees * rs < -thrYaw) {
                next.left = true;
                setStep(3);
              }
            } else if (next.blinks >= 2) {
              setStep(4);
              stopRecordingAndUpload();
              setTimeout(() => cancelAnimationFrame(rafRef.current), 120);
            }
            return next;
          });
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  const stepsLabels = ["Look straight", "Turn your head to the right", "Turn your head to the left", "Blink twice"];

  return (
    <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-[min(92vw,560px)]">
        <div className="text-sm text-zinc-400 mb-2">
          Keep your face centered. We’ll guide you to look straight, turn right, turn left, and blink twice.
          Video is recorded locally and uploaded only after checks pass.
        </div>

        {/* Status row */}
        <div className="flex items-center justify-between text-xs mb-2">
          <div className="flex items-center gap-2">
            <Badge ok={status.straight}>Straight</Badge>
            <Badge ok={status.right}>Right</Badge>
            <Badge ok={status.left}>Left</Badge>
            <Badge ok={status.blinks >= 2}>Blink x2</Badge>
          </div>
          <div className="text-zinc-400">{aiReady && !aiFailed ? `AI ✓ Yaw ${yawDeg}°` : "Simple mode"}</div>
        </div>

        <video ref={videoRef} playsInline muted autoPlay className="w-full rounded-lg bg-black aspect-video" />

        {/* Instruction + controls */}
        <div className="mt-3 flex items-center justify-between">
          <div className="text-[#d4af37] font-medium">
            {step < 4 ? (stepsLabels[step] || "Get ready…") : "All checks passed ✓"}
          </div>
          {!recording ? (
            <button type="button" onClick={begin} className="px-3 py-2 rounded bg-[#d4af37] text-black font-semibold">
              Start
            </button>
          ) : (
            <div className="text-xs text-zinc-400">Recording…</div>
          )}
        </div>

        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded border border-zinc-700">
            Close
          </button>
        </div>

        {!aiReady && !aiFailed && <div className="text-xs text-zinc-400 mt-2">Loading liveness checks…</div>}
      </div>
    </div>
  );
}

function Badge({ ok, children }) {
  return (
    <span
      className={`px-2 py-1 rounded text-[11px] border ${
        ok ? "border-emerald-600 text-emerald-300" : "border-zinc-700 text-zinc-400"
      }`}
    >
      {children} {ok ? "✓" : ""}
    </span>
  );
}

/** ========= Location: Detect (GPS) + Reverse geocode (OSM) ========= **/
function DetectLocationButton({ onSelect }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function titleCase(s = "") {
    return s
      .toLowerCase()
      .replace(/\b[a-z]/g, (m) => m.toUpperCase())
      .trim();
  }

  function normalizeNgState(raw = "") {
    let s = raw.trim();
    s = s.replace(/\s+State$/i, ""); // drop trailing "State"
    if (/^federal\s+capital\s+territory$/i.test(s) || /^abuja$/i.test(s) || /^fct$/i.test(s)) return "FCT";
    return titleCase(s);
  }

  function normalizeNgLga(raw = "") {
    return titleCase(raw); // keep punctuation; just title-case
  }

  async function detect() {
    setBusy(true);
    setErr("");
    try {
      // 1) get GPS from browser
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          maximumAge: 30_000,
          timeout: 20_000,
          enableHighAccuracy: true,
        })
      );
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      // 2) reverse geocode via OSM (no custom headers; browsers forbid User-Agent)
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lon)}&zoom=14&addressdetails=1`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Location service unavailable.");
      const j = await res.json();

      const a = j?.address || {};
      const state = normalizeNgState(a.state || a.region || "");
      const lga = normalizeNgLga(a.county || a.city || a.district || a.town || a.suburb || a.village || "");
      const niceAddress = (j?.display_name || "").trim();

      if (!state) throw new Error("Could not detect state.");
      onSelect?.({ state, lga, address: niceAddress });
    } catch (e) {
      setErr(e?.message || "Failed to detect location.");
    } finally {
      setBusy(false);
      setTimeout(() => setErr(""), 3500);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={detect}
        className="px-2 py-1 text-xs rounded border border-zinc-700 hover:bg-zinc-900"
        disabled={busy}
      >
        {busy ? "Detecting…" : "Use my location"}
      </button>
      {err && <span className="text-[11px] text-red-400">{err}</span>}
    </div>
  );
}

/** ========= Main Page ========= **/
const SERVICE_OPTIONS = [
  "Barbering",
  "Hair Styling (female)",
  "Wig installation",
  "Dreadlock / Locs",
  "Pedicure",
  "Manicure",
  "Nails (extensions/maintenance)",
  "Makeup",
  "Skincare / Facial",
  "Others",
];

export default function BecomePro() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Minimal, client-like required fields
  const [identity, setIdentity] = useState({
    firstName: "",
    middleName: "", // ✅ new optional
    lastName: "",
    phone: "", // ✅ optional now
    email: "",
    state: "",
    lga: "",
    photoUrl: "",
  });
  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState(null);

  // Email verification state
  const [emailVerified, setEmailVerified] = useState(!!auth.currentUser?.emailVerified);
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);
  const [emailVerifyMsg, setEmailVerifyMsg] = useState("");

  // Pro basics
  const [professional, setProfessional] = useState({
    services: [],
    years: "",
    workPhotos: [""],
    hasCert: "no",
    certUrl: "",
    profileVisible: true,
    nationwide: false,
    otherServicesDetailed: "",
  });

  // Sections
  const [business, setBusiness] = useState({
    mode: "shop",
    shopName: "",
    shopAddress: "",
    shopPhotoOutside: "",
    shopPhotoInside: "",
  });

  const [availability, setAvailability] = useState({
    days: { Mon: false, Tue: false, Wed: false, Thu: false, Fri: false, Sat: false, Sun: false },
    start: "",
    end: "",
    emergency: "no",
    homeService: "no",
    homeServicePrice: "",
    statesCovered: [],
  });

  const [pricing, setPricing] = useState({
    menCut: "",
    womenCut: "",
    locs: "",
    manicure: "",
    pedicure: "",
    otherServices: "",
  });

  const [verification, setVerification] = useState({
    idType: "",
    idUrl: "",
    livenessVideoUrl: "",
    deferred: true,
    // Required for "Verified", optional for submit:
    residentialAddress: "",
    originState: "",
    originLga: "",
  });

  const [agreements, setAgreements] = useState({ terms: false, privacy: false });

  // Prefill email from /api/me
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/api/me");
        setIdentity((p) => ({ ...p, email: data?.email || p.email }));
      } catch {}
    })();
  }, []);

  // Keep a fresh emailVerified flag if user returns after verifying
  async function recheckEmailVerification() {
    try {
      if (auth.currentUser) {
        await reload(auth.currentUser);
        setEmailVerified(!!auth.currentUser.emailVerified);
        setEmailVerifyMsg(auth.currentUser.emailVerified ? "Email verified ✓" : "Not verified yet.");
        setTimeout(() => setEmailVerifyMsg(""), 3000);
      }
    } catch {
      // ignore
    }
  }

  async function sendVerification() {
    try {
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser);
        setEmailVerificationSent(true);
        setEmailVerifyMsg("Verification email sent. Check your inbox.");
        setTimeout(() => setEmailVerifyMsg(""), 4000);
      } else {
        setEmailVerifyMsg("Please sign in first.");
        setTimeout(() => setEmailVerifyMsg(""), 4000);
      }
    } catch (e) {
      setEmailVerifyMsg(e?.message || "Failed to send verification email.");
      setTimeout(() => setEmailVerifyMsg(""), 4000);
    }
  }

  // States list (soft)
  const [allStates, setAllStates] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/api/geo/ng");
        if (!alive) return;
        setAllStates(Array.isArray(data?.states) ? data.states : []);
      } catch {
        if (alive) setAllStates([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const stateList = useMemo(() => (allStates || []).slice().sort(), [allStates]);

  // Submit gate (✅ phone no longer required)
  const canSubmit =
    identity.firstName &&
    identity.state &&
    (professional.nationwide || identity.lga) &&
    professional.services.length > 0 &&
    agreements.terms &&
    agreements.privacy;

  function computeVerificationStatus() {
    if (verification.deferred) return "unverified";
    const docOk =
      emailVerified && // ✅ email must be verified
      verification.idType &&
      verification.idUrl &&
      verification.livenessVideoUrl &&
      verification.residentialAddress &&
      verification.originState &&
      verification.originLga;
    return docOk ? "verified" : "unverified";
  }

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setMsg("");
    try {
      const verificationStatus = computeVerificationStatus();

      const payload = {
        identity: {
          ...identity,
          // optional phone; middleName included
        },
        professional,
        business,
        availability: {
          ...availability,
          statesCovered: professional.nationwide ? stateList : availability.statesCovered,
        },
        pricing,
        verification: {
          idType: verification.idType || "",
          idUrl: verification.idUrl || "",
          livenessVideoUrl: verification.livenessVideoUrl || "",
          deferred: !!verification.deferred,
          residentialAddress: verification.residentialAddress || "",
          originState: verification.originState || "",
          originLga: verification.originLga || "",
          ...(phoneVerifiedAt ? { phoneVerifiedAt } : {}),
          ...(emailVerified
            ? {
                emailVerified: true,
                emailVerifiedAt: new Date().toISOString(),
              }
            : { emailVerified: false }),
        },
        status: "submitted",
        acceptedTerms: !!agreements.terms,
        acceptedPrivacy: !!agreements.privacy,
        agreements: { terms: !!agreements.terms, privacy: !!agreements.privacy },
        verificationStatus,
      };

      await api.put("/api/pros/me", payload);
      nav("/apply/thanks");
    } catch (err) {
      console.error(err);
      setMsg("Failed to submit application.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h2 className="text-2xl font-semibold mb-6">Become a Pro</h2>
      <p className="text-zinc-400 -mt-4 mb-6 text-sm">
        Start with a few basics. You can complete verification and other details later.
      </p>
      {msg && <div className="mb-4 text-sm text-red-400">{msg}</div>}

      <form onSubmit={submit} className="space-y-6">
        {/* SECTION A: Minimal */}
        <Section title="Basic Info (required)" id="basic">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="First Name *"
              value={identity.firstName}
              onChange={(e) => setIdentity({ ...identity, firstName: e.target.value })}
              required
            />
            <Input
              label="Middle Name (optional)"
              value={identity.middleName}
              onChange={(e) => setIdentity({ ...identity, middleName: e.target.value })}
            />
            <Input
              label="Last Name"
              value={identity.lastName}
              onChange={(e) => setIdentity({ ...identity, lastName: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div className="md:col-span-1">
              <Label>Email</Label>
              <input
                className={FIELD}
                type="email"
                value={identity.email}
                onChange={(e) => setIdentity({ ...identity, email: e.target.value })}
                placeholder="you@example.com"
              />
            </div>

            <div className="md:col-span-1">
              <Label>Phone Number (optional)</Label>
              <input
                className={FIELD}
                value={identity.phone}
                onChange={(e) => {
                  setIdentity({ ...identity, phone: e.target.value });
                  setPhoneVerifiedAt(null);
                }}
                placeholder="080..."
              />
              {/* Only show OTP if phone is present */}
              {identity.phone ? (
                <>
                  <PhoneOTP
                    phone={identity.phone}
                    disabled={!identity.phone}
                    onVerified={(iso) => setPhoneVerifiedAt(iso)}
                  />
                  {phoneVerifiedAt && <div className="text-xs text-emerald-300 mt-1">Phone verified</div>}
                </>
              ) : (
                <div className="text-xs text-zinc-500 mt-1">Phone is optional.</div>
              )}
            </div>

            <div className="md:col-span-1">
              <Label>Profile Photo</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={FIELD}
                  placeholder="Photo URL"
                  value={identity.photoUrl}
                  onChange={(e) => setIdentity({ ...identity, photoUrl: e.target.value })}
                />
                {/* Menu (files/selfie/rear) */}
                <SmartUpload
                  title="Upload"
                  folder="kpocha/pro-apps"
                  accept="image/*"
                  onUploaded={(url) => setIdentity({ ...identity, photoUrl: url })}
                />
                {/* Always-visible camera buttons */}
                <IOSCameraButtons
                  folder="kpocha/pro-apps"
                  onUploaded={(url) => setIdentity({ ...identity, photoUrl: url })}
                />
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={professional.nationwide}
                onChange={(e) => setProfessional({ ...professional, nationwide: e.target.checked })}
              />
              Offer services nationwide (Nigeria)
            </label>

            <div className="flex items-center justify-between">
              <div className="flex-1">
                <NgGeoPicker
                  valueState={identity.state}
                  onChangeState={(st) => {
                    setIdentity({ ...identity, state: st, lga: "" });
                    if (st && !professional.nationwide) {
                      setAvailability((p) => ({
                        ...p,
                        statesCovered: p.statesCovered.includes(st) ? p.statesCovered : [...p.statesCovered, st],
                      }));
                    }
                  }}
                  valueLga={identity.lga}
                  onChangeLga={(l) => setIdentity({ ...identity, lga: l })}
                  required
                  className="grid grid-cols-1 gap-3"
                />
              </div>
              <div className="ml-3">
                <DetectLocationButton
                  onSelect={({ state, lga, address }) => {
                    if (state) setIdentity((p) => ({ ...p, state }));
                    if (lga) setIdentity((p) => ({ ...p, lga }));
                    if (address) setBusiness((b) => ({ ...b, shopAddress: b.shopAddress || address }));
                  }}
                />
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-2 text-sm">
            <Check
              label={
                <>
                  I agree to the{" "}
                  <a className="text-gold underline" href="/legal#terms" target="_blank" rel="noreferrer">
                    Terms &amp; Conditions
                  </a>
                </>
              }
              checked={agreements.terms}
              onChange={() => setAgreements({ ...agreements, terms: !agreements.terms })}
            />
            <Check
              label={
                <>
                  I agree to the{" "}
                  <a className="text-gold underline" href="/legal#privacy" target="_blank" rel="noreferrer">
                    Privacy Policy
                  </a>
                </>
              }
              checked={agreements.privacy}
              onChange={() => setAgreements({ ...agreements, privacy: !agreements.privacy })}
            />
          </div>
        </Section>

        {/* Verification section */}
        <OptionalSection title="Verification — required for the Verified badge">
          <div className="mb-3 space-y-2">
            {/* ✅ Email verification block */}
            <Label>Email Verification (required for Verified)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-xs px-2 py-1 rounded border ${
                  emailVerified ? "border-emerald-600 text-emerald-300" : "border-zinc-700 text-zinc-300"
                }`}
              >
                {emailVerified ? "Verified ✓" : "Not verified"}
              </span>
              {!emailVerified && (
                <>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-zinc-700 hover:bg-zinc-900"
                    onClick={sendVerification}
                  >
                    Send verification email
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-zinc-700 hover:bg-zinc-900"
                    onClick={recheckEmailVerification}
                  >
                    I’ve verified, re-check
                  </button>
                </>
              )}
              {emailVerificationSent && <span className="text-[11px] text-zinc-400">Sent — check your inbox</span>}
              {emailVerifyMsg && <span className="text-[11px] text-zinc-400">{emailVerifyMsg}</span>}
            </div>
          </div>

          <div className="mb-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!verification.deferred}
                onChange={(e) => setVerification({ ...verification, deferred: e.target.checked })}
              />
              Verify later
            </label>
          </div>

          {!verification.deferred && (
            <>
              <Select
                label="ID Type"
                value={verification.idType}
                onChange={(e) => setVerification({ ...verification, idType: e.target.value })}
                options={["National ID", "Voter’s Card", "Driver’s License", "International Passport"]}
              />

              {/* Residential address (house address) */}
              <div className="mt-3">
                <Label>Residential / House Address (required for verification)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={FIELD}
                    placeholder="Your house address"
                    value={verification.residentialAddress}
                    onChange={(e) => setVerification({ ...verification, residentialAddress: e.target.value })}
                  />
                  <DetectLocationButton
                    onSelect={({ address }) => {
                      if (address) setVerification((v) => ({ ...v, residentialAddress: address }));
                    }}
                  />
                </div>
              </div>

              {/* ID + Liveness */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div>
                  <Label>Government ID</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className={FIELD}
                      placeholder="ID Image/PDF URL"
                      value={verification.idUrl}
                      onChange={(e) => setVerification({ ...verification, idUrl: e.target.value })}
                    />
                    <SmartUpload
                      title="Upload"
                      folder="kpocha/pro-apps"
                      accept="image/*,application/pdf"
                      onUploaded={(url) => setVerification({ ...verification, idUrl: url })}
                    />
                    <IOSCameraButtons
                      folder="kpocha/pro-apps"
                      onUploaded={(url) => setVerification({ ...verification, idUrl: url })}
                    />
                  </div>
                </div>

                <div>
                  <Label>Selfie (liveness video)</Label>
                  <div className="space-y-2">
                    <LivenessCapture onUploaded={(url) => setVerification({ ...verification, livenessVideoUrl: url })} />
                    {verification.livenessVideoUrl && (
                      <input
                        className={FIELD}
                        value={verification.livenessVideoUrl}
                        readOnly
                        onFocus={(e) => e.target.select()}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* State & LGA of Origin */}
              <div className="mt-3">
                <Label>State & Local Government of Origin (required for verification)</Label>
                <NgGeoPicker
                  valueState={verification.originState}
                  onChangeState={(st) => setVerification((v) => ({ ...v, originState: st, originLga: "" }))}
                  valueLga={verification.originLga}
                  onChangeLga={(l) => setVerification((v) => ({ ...v, originLga: l }))}
                  required={false}
                  className="grid grid-cols-1 md:grid-cols-2 gap-3"
                />
              </div>
            </>
          )}
        </OptionalSection>

        {/* Professional details */}
        <OptionalSection title="Professional details (years, certificate, photos)">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select
              label="Years of Experience"
              value={professional.years}
              onChange={(e) => setProfessional({ ...professional, years: e.target.value })}
              options={["0–1 year", "2–4 years", "5–10 years", "10+ years"]}
            />
            <Select
              label="Any certification?"
              value={professional.hasCert}
              onChange={(e) => setProfessional({ ...professional, hasCert: e.target.value })}
              options={["no", "yes"]}
            />
            {professional.hasCert === "yes" && (
              <div className="md:col-span-1">
                <Label>Certificate</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={FIELD}
                    placeholder="Certificate URL"
                    value={professional.certUrl}
                    onChange={(e) => setProfessional({ ...professional, certUrl: e.target.value })}
                  />
                  <SmartUpload
                    title="Upload"
                    folder="kpocha/pro-apps"
                    accept="image/*,application/pdf"
                    onUploaded={(url) => setProfessional({ ...professional, certUrl: url })}
                  />
                  <IOSCameraButtons
                    folder="kpocha/pro-apps"
                    onUploaded={(url) => setProfessional({ ...professional, certUrl: url })}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="mt-3">
            <Label>Work Photos</Label>
            {professional.workPhotos.map((u, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-2">
                <input
                  className={FIELD}
                  placeholder={`Photo/Video URL ${idx + 1}`}
                  value={u}
                  onChange={(e) => {
                    const arr = [...professional.workPhotos];
                    arr[idx] = e.target.value;
                    setProfessional({ ...professional, workPhotos: arr });
                  }}
                />
                <SmartUpload
                  title="Upload"
                  folder="kpocha/pro-apps"
                  accept="image/*,video/*"
                  onUploaded={(url) => {
                    const arr = [...professional.workPhotos];
                    arr[idx] = url;
                    setProfessional({ ...professional, workPhotos: arr });
                  }}
                />
                <IOSCameraButtons
                  folder="kpocha/pro-apps"
                  allowVideo
                  onUploaded={(url) => {
                    const arr = [...professional.workPhotos];
                    arr[idx] = url;
                    setProfessional({ ...professional, workPhotos: arr });
                  }}
                />
                {idx > 0 && (
                  <button
                    type="button"
                    className="text-sm text-red-400"
                    onClick={() =>
                      setProfessional({
                        ...professional,
                        workPhotos: professional.workPhotos.filter((_, i) => i !== idx),
                      })
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="text-sm text-gold underline"
              onClick={() => setProfessional({ ...professional, workPhotos: [...professional.workPhotos, ""] })}
            >
              + Add another
            </button>
          </div>
        </OptionalSection>

        {/* Business information (includes address) */}
        <OptionalSection title="Business information">
          <Select
            label="Work Mode"
            value={business.mode}
            onChange={(e) => setBusiness({ ...business, mode: e.target.value })}
            options={["shop", "home service", "both"]}
          />
          {(business.mode === "shop" || business.mode === "both") && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <Input
                label="Business / Shop Name"
                value={business.shopName}
                onChange={(e) => setBusiness({ ...business, shopName: e.target.value })}
              />
              <div className="md:col-span-1">
                <Input
                  label="Business Address"
                  value={business.shopAddress}
                  onChange={(e) => setBusiness({ ...business, shopAddress: e.target.value })}
                />
                <div className="mt-1">
                  <DetectLocationButton
                    onSelect={({ address }) => {
                      if (address) setBusiness((b) => ({ ...b, shopAddress: address }));
                    }}
                  />
                </div>
              </div>
              <div>
                <Label>Photo (outside)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={FIELD}
                    placeholder="URL"
                    value={business.shopPhotoOutside}
                    onChange={(e) => setBusiness({ ...business, shopPhotoOutside: e.target.value })}
                  />
                  <SmartUpload
                    title="Upload"
                    folder="kpocha/pro-apps"
                    accept="image/*"
                    onUploaded={(url) => setBusiness({ ...business, shopPhotoOutside: url })}
                  />
                  <IOSCameraButtons
                    folder="kpocha/pro-apps"
                    onUploaded={(url) => setBusiness({ ...business, shopPhotoOutside: url })}
                  />
                </div>
              </div>
              <div>
                <Label>Photo (inside)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={FIELD}
                    placeholder="URL"
                    value={business.shopPhotoInside}
                    onChange={(e) => setBusiness({ ...business, shopPhotoInside: e.target.value })}
                  />
                  <SmartUpload
                    title="Upload"
                    folder="kpocha/pro-apps"
                    accept="image/*"
                    onUploaded={(url) => setBusiness({ ...business, shopPhotoInside: url })}
                  />
                  <IOSCameraButtons
                    folder="kpocha/pro-apps"
                    onUploaded={(url) => setBusiness({ ...business, shopPhotoInside: url })}
                  />
                </div>
              </div>
            </div>
          )}
        </OptionalSection>

        {/* Pricing */}
        <OptionalSection title="Pricing">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Men’s Cut (₦)" value={pricing.menCut} onChange={(e) => setPricing({ ...pricing, menCut: e.target.value })} />
            <Input label="Women’s Cut (₦)" value={pricing.womenCut} onChange={(e) => setPricing({ ...pricing, womenCut: e.target.value })} />
            <Input label="Dreadlock (₦)" value={pricing.locs} onChange={(e) => setPricing({ ...pricing, locs: e.target.value })} />
            <Input label="Manicure (₦)" value={pricing.manicure} onChange={(e) => setPricing({ ...pricing, manicure: e.target.value })} />
            <Input label="Pedicure (₦)" value={pricing.pedicure} onChange={(e) => setPricing({ ...pricing, pedicure: e.target.value })} />
          </div>
          <textarea
            className={`${FIELD} mt-3`}
            placeholder="Other services & prices"
            value={pricing.otherServices}
            onChange={(e) => setPricing({ ...pricing, otherServices: e.target.value })}
            rows={4}
          />
        </OptionalSection>

        {/* FINAL STEP */}
        <button disabled={!canSubmit || busy} className="w-full bg-gold text-black font-semibold rounded-lg py-2 disabled:opacity-60">
          {busy ? "Submitting..." : "Submit Application"}
        </button>

        <p className="text-xs text-zinc-500 text-center">
          After submission, complete verification to get a <span className="text-emerald-400">Verified</span> tick.
          Until then, clients see a warning when booking.
        </p>
      </form>
    </div>
  );
}

/* ---------- UI bits ---------- */
function Section({ title, id, children }) {
  return (
    <section id={id} className="rounded-lg border border-zinc-800 p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}
function OptionalSection({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left px-4 py-3 flex items-center justify-between"
      >
        <span className="font-semibold">{title}</span>
        <span className="text-sm text-zinc-400">{open ? "Hide" : "Add now"}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </section>
  );
}
function Label({ children }) {
  return <div className="text-sm text-zinc-300 mb-1">{children}</div>;
}
function Input({ label, required, ...props }) {
  return (
    <label className="block">
      <Label>
        {label}
        {required ? " *" : ""}
      </Label>
      <input {...props} className={FIELD} />
    </label>
  );
}
function Select({ label, options = [], required, ...props }) {
  return (
    <label className="block">
      <Label>
        {label}
        {required ? " *" : ""}
      </Label>
      <select {...props} className={FIELD}>
        <option value="">{required ? "Select…" : "Select…"}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
function Check({ label, ...props }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
