// apps/web/src/pages/BecomePro.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import PhoneOTP from "../components/PhoneOTP.jsx";

/** ========= Cloudinary tiny helper (frontend, unsigned) ========= **/
/* Accept either naming style:
   - VITE_CLOUDINARY_CLOUD, VITE_CLOUDINARY_UNSIGNED_PRESET
   - VITE_CLOUDINARY_CLOUD_NAME, VITE_CLOUDINARY_UPLOAD_PRESET
*/
const CLOUD =
  import.meta.env.VITE_CLOUDINARY_CLOUD ||
  import.meta.env.VITE_CLOUDINARY_CLOUD_NAME ||
  "";
const PRESET =
  import.meta.env.VITE_CLOUDINARY_UNSIGNED_PRESET ||
  import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET ||
  "";

async function uploadToCloudinary(file, { folder = "kpocha/pro-apps" } = {}) {
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

/** ========= Camera-aware uploader: file + camera fallback ========= */
function NativeUpload({
  label = "Upload",
  accept = "image/*,video/*",
  capture = "user",
  onUploaded,
  folder = "kpocha/pro-apps",
  className = "",
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef();

  async function handleFiles(files) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const url = await uploadToCloudinary(files[0], { folder });
      onUploaded?.(url);
    } catch (e) {
      alert(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const [showCam, setShowCam] = useState(false);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture={capture}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        type="button"
        className="px-3 py-2 rounded border border-zinc-700 hover:bg-zinc-900"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title="Open camera on mobile; file picker on desktop"
      >
        {busy ? "Uploading…" : label}
      </button>

      {/* Desktop camera */}
      <button
        type="button"
        className="text-xs underline text-zinc-400"
        onClick={() => setShowCam(true)}
        title="Use webcam (desktop fallback)"
      >
        Open Camera (beta)
      </button>

      {showCam && (
        <CameraModal
          onClose={() => setShowCam(false)}
          onCapture={async (blob) => {
            setBusy(true);
            try {
              const file = new File([blob], "capture.jpg", { type: blob.type || "image/jpeg" });
              const url = await uploadToCloudinary(file, { folder });
              onUploaded?.(url);
              setShowCam(false);
            } catch (e) {
              alert(e.message || "Upload failed");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

/** Simple webcam modal that snaps 1 frame (Safari-friendly) */
function CameraModal({ onClose, onCapture }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "user" } },
          audio: false,
        });
        if (videoRef.current) {
          // iOS/Safari quirks
          videoRef.current.muted = true;
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play?.();
          };
        }
      } catch {
        setErr("Camera access failed. Please allow permission and use HTTPS.");
      }
    })();
    return () => {
      stream?.getTracks()?.forEach((t) => t.stop());
    };
  }, []);

  const snap = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => blob && onCapture(blob), "image/jpeg", 0.9);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 w-[min(92vw,480px)]">
        <div className="text-sm text-zinc-400 mb-2">
          Tip: On iOS use Safari, and ensure the site is HTTPS. Video is muted &amp; plays inline.
        </div>
        {err && <div className="text-red-400 text-sm mb-2">{err}</div>}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full rounded-lg bg-black aspect-video"
        />
        <canvas ref={canvasRef} className="hidden" />
        <div className="mt-3 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded border border-zinc-700">
            Cancel
          </button>
          <button
            type="button"
            onClick={snap}
            className="px-3 py-2 rounded bg-[#d4af37] text-black font-semibold"
          >
            Capture
          </button>
        </div>
      </div>
    </div>
  );
}

/** ========= SMART Liveness (video) with on-device checks ========= */
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
    // If already available
    if (window.FaceLandmarker && window.FilesetResolver) {
      resolve({ FaceLandmarker: window.FaceLandmarker, FilesetResolver: window.FilesetResolver });
      return;
    }
    const script = document.createElement("script");
    // Pinned version known to work broadly
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
  const [blinkNow, setBlinkNow] = useState(false);
  const rightSignRef = useRef(null); // determines which sign means "right" on this device
  const straightHoldMsRef = useRef(0);
  const lastBlinkStateRef = useRef(false);
  const lastTsRef = useRef(0);

  // Simple fallback timer (used if AI fails)
  const timerRef = useRef(null);

  const stepsLabels = [
    "Look straight",
    "Turn your head to the right",
    "Turn your head to the left",
    "Blink twice",
  ];

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
        if (i < stepsLabels.length) setStep(i);
        if (i >= stepsLabels.length + 2) {
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
        // --- Orientation (yaw) from the 4x4 transform matrix ---
        const mat = res.facialTransformationMatrixes?.[0]?.data || null;
        if (mat && mat.length >= 12) {
          // 3x3 rotation (row-major) elements
          const r00 = mat[0], r01 = mat[1], r02 = mat[2];
          const r10 = mat[4], r11 = mat[5], r12 = mat[6];
          const r20 = mat[8], r21 = mat[9], r22 = mat[10];
          // Estimate yaw (rotation around Y). This convention is robust enough for our purpose.
          const yaw = Math.asin(Math.max(-1, Math.min(1, -r20)));
          const yawDegrees = (yaw * 180) / Math.PI;
          setYawDeg(Math.round(yawDegrees));

          // --- Blink detection from blendshapes (edge-detect) ---
          const blend = res.faceBlendshapes?.[0]?.categories || [];
          const blinkL = getBlend(blend, "eyeBlinkLeft") > 0.5;
          const blinkR = getBlend(blend, "eyeBlinkRight") > 0.5;
          const bothBlink = blinkL && blinkR;
          setBlinkNow(bothBlink);

          // Edge detect: count a blink only when transitioning from open -> blink
          if (bothBlink && !lastBlinkStateRef.current) {
            setStatus((s) => ({ ...s, blinks: Math.min(2, s.blinks + 1) }));
          }
          lastBlinkStateRef.current = bothBlink;

          // --- Step logic ---
          const dt = now - (lastTsRef.current || now);
          lastTsRef.current = now;

          const thrYaw = 12; // degrees
          const nearCenter = Math.abs(yawDegrees) < 8;

          setStatus((s) => {
            let next = { ...s };

            // Step 0: look straight for ~0.6s
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
              // Step 1: turn right (define sign on first success)
              if (Math.abs(yawDegrees) > thrYaw) {
                const sgn = yawDegrees > 0 ? 1 : -1;
                rightSignRef.current = sgn; // define which sign is "right"
                next.right = true;
                setStep(2);
              }
            } else if (!next.left) {
              // Step 2: turn left (opposite sign)
              const rs = rightSignRef.current || 1;
              if (yawDegrees * rs < -thrYaw) {
                next.left = true;
                setStep(3);
              }
            } else {
              // Step 3: blink twice
              if (next.blinks >= 2) {
                setStep(4);
                // Done!
                stopRecordingAndUpload();
                // Stop loop a moment later
                setTimeout(() => cancelAnimationFrame(rafRef.current), 100);
              }
            }
            return next;
          });
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

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
          {aiReady && !aiFailed ? (
            <div className="text-zinc-400">AI ✓ {yawDeg ? `Yaw ${yawDeg}°` : ""}</div>
          ) : (
            <div className="text-zinc-400">Simple mode</div>
          )}
        </div>

        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full rounded-lg bg-black aspect-video"
        />

        {/* Instruction + controls */}
        <div className="mt-3 flex items-center justify-between">
          <div className="text-[#d4af37] font-medium">
            {step < 4 ? (stepsLabels[step] || "Get ready…") : "All checks passed ✓"}
          </div>
          {!recording ? (
            <button
              type="button"
              onClick={begin}
              className="px-3 py-2 rounded bg-[#d4af37] text-black font-semibold"
            >
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

        {!aiReady && !aiFailed && (
          <div className="text-xs text-zinc-400 mt-2">Loading liveness checks…</div>
        )}
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
    lastName: "",
    phone: "",
    email: "",
    state: "",
    lga: "",
    photoUrl: "",
  });
  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState(null);

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

  const canSubmit =
    identity.firstName &&
    identity.phone &&
    identity.state &&
    (professional.nationwide || identity.lga) &&
    professional.services.length > 0 &&
    agreements.terms &&
    agreements.privacy;

  function computeVerificationStatus() {
    if (verification.deferred) return "unverified";
    const docOk = verification.idType && verification.idUrl && verification.livenessVideoUrl;
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
        identity,
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
          ...(phoneVerifiedAt ? { phoneVerifiedAt } : {}),
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
              label="Last Name"
              value={identity.lastName}
              onChange={(e) => setIdentity({ ...identity, lastName: e.target.value })}
            />
            <Input
              label="Email"
              type="email"
              value={identity.email}
              onChange={(e) => setIdentity({ ...identity, email: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div>
              <Label>Phone Number *</Label>
              <input
                className={FIELD}
                value={identity.phone}
                onChange={(e) => {
                  setIdentity({ ...identity, phone: e.target.value });
                  setPhoneVerifiedAt(null);
                }}
                required
                placeholder="080..."
              />
              <PhoneOTP
                phone={identity.phone}
                disabled={!identity.phone}
                onVerified={(iso) => setPhoneVerifiedAt(iso)}
              />
              {phoneVerifiedAt && <div className="text-xs text-emerald-300 mt-1">Phone verified</div>}
            </div>

            <div>
              <Label>Profile Photo</Label>
              <div className="flex gap-2">
                <input
                  className={FIELD}
                  placeholder="Photo URL"
                  value={identity.photoUrl}
                  onChange={(e) => setIdentity({ ...identity, photoUrl: e.target.value })}
                />
                <NativeUpload
                  label="Upload"
                  accept="image/*"
                  capture="user"
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

            <NgGeoPicker
              valueState={identity.state}
              onChangeState={(st) => {
                setIdentity({ ...identity, state: st, lga: "" });
                if (st && !professional.nationwide) {
                  setAvailability((p) => ({
                    ...p,
                    statesCovered: p.statesCovered.includes(st)
                      ? p.statesCovered
                      : [...p.statesCovered, st],
                  }));
                }
              }}
              valueLga={identity.lga}
              onChangeLga={(l) => setIdentity({ ...identity, lga: l })}
              required
              className="grid grid-cols-1 gap-3"
            />
          </div>

          <div className="mt-4">
            <Label>What service do you offer? *</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SERVICE_OPTIONS.map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={professional.services.includes(opt)}
                    onChange={() =>
                      setProfessional((p) => {
                        const has = p.services.includes(opt);
                        return { ...p, services: has ? p.services.filter((s) => s !== opt) : [...p.services, opt] };
                      })
                    }
                  />
                  {opt}
                </label>
              ))}
            </div>

            {/* When "Others" is checked, ask for details + price list */}
            {professional.services.includes("Others") && (
              <div className="mt-3">
                <textarea
                  className={FIELD}
                  placeholder="Please specify other services & prices"
                  rows={4}
                  value={professional.otherServicesDetailed}
                  onChange={(e) =>
                    setProfessional({ ...professional, otherServicesDetailed: e.target.value })
                  }
                />
              </div>
            )}
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div>
                  <Label>Government ID</Label>
                  <div className="flex gap-2">
                    <input
                      className={FIELD}
                      placeholder="ID Image URL"
                      value={verification.idUrl}
                      onChange={(e) => setVerification({ ...verification, idUrl: e.target.value })}
                    />
                    <NativeUpload
                      label="Upload"
                      accept="image/*,application/pdf"
                      capture="environment"
                      onUploaded={(url) => setVerification({ ...verification, idUrl: url })}
                    />
                  </div>
                </div>

                <div>
                  <Label>Selfie (liveness video)</Label>
                  <div className="space-y-2">
                    <LivenessCapture
                      onUploaded={(url) => setVerification({ ...verification, livenessVideoUrl: url })}
                    />
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
              <div>
                <Label>Certificate</Label>
                <div className="flex gap-2">
                  <input
                    className={FIELD}
                    placeholder="Certificate URL"
                    value={professional.certUrl}
                    onChange={(e) => setProfessional({ ...professional, certUrl: e.target.value })}
                  />
                  <NativeUpload
                    label="Upload"
                    accept="image/*,application/pdf"
                    capture="user"
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
                  placeholder={`Photo URL ${idx + 1}`}
                  value={u}
                  onChange={(e) => {
                    const arr = [...professional.workPhotos];
                    arr[idx] = e.target.value;
                    setProfessional({ ...professional, workPhotos: arr });
                  }}
                />
                <NativeUpload
                  label="Upload"
                  accept="image/*,video/*"
                  capture="environment"
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

        {/* Business information */}
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
              <Input
                label="Business Address"
                value={business.shopAddress}
                onChange={(e) => setBusiness({ ...business, shopAddress: e.target.value })}
              />
              <div>
                <Label>Photo (outside)</Label>
                <div className="flex gap-2">
                  <input
                    className={FIELD}
                    placeholder="URL"
                    value={business.shopPhotoOutside}
                    onChange={(e) => setBusiness({ ...business, shopPhotoOutside: e.target.value })}
                  />
                  <NativeUpload
                    label="Upload"
                    accept="image/*"
                    capture="environment"
                    onUploaded={(url) => setBusiness({ ...business, shopPhotoOutside: url })}
                  />
                </div>
              </div>
              <div>
                <Label>Photo (inside)</Label>
                <div className="flex gap-2">
                  <input
                    className={FIELD}
                    placeholder="URL"
                    value={business.shopPhotoInside}
                    onChange={(e) => setBusiness({ ...business, shopPhotoInside: e.target.value })}
                  />
                  <NativeUpload
                    label="Upload"
                    accept="image/*"
                    capture="environment"
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
        <button
          disabled={!canSubmit || busy}
          className="w-full bg-gold text-black font-semibold rounded-lg py-2 disabled:opacity-60"
        >
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
