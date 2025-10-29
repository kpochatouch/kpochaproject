import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, submitProApplication } from "../lib/api";
import NgGeoPicker from "../components/NgGeoPicker.jsx";
import PhoneOTP from "../components/PhoneOTP.jsx";

/* ---------- Cloudinary config (frontend env) ---------- */
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "";

/* ---------- Services ---------- */
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

/* ---------- Script loader ---------- */
function loadScriptOnce(src, id) {
  return new Promise((resolve, reject) => {
    if (id && document.getElementById(id)) return resolve();
    const s = document.createElement("script");
    if (id) s.id = id;
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ---------- Liveness modal with randomized prompts ---------- */
function LivenessModal({ onClose, onUploaded }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const faceMeshRef = useRef(null);

  const [error, setError] = useState("");
  const [landmarks, setLandmarks] = useState(null);

  // ---- Randomized thresholds + wording (session-stable) ----
  const T = useMemo(
    () => ({
      BLINK_MAX: 0.18 + (Math.random() * 0.04 - 0.02), // ~0.16–0.20
      YAW_ABS: 0.06 + (Math.random() * 0.02 - 0.01),   // ~0.05–0.07
      MOUTH_MIN: 0.32 + (Math.random() * 0.06 - 0.03), // ~0.29–0.35
    }),
    []
  );
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Steps pool (wording randomized, checks use jittered thresholds)
  const stepsPool = useMemo(
    () => [
      {
        key: "blink",
        label: pick([
          "Blink your eyes",
          "Close and open your eyes",
          "Give me a quick blink",
          "Blink twice quickly",
        ]),
        check: (L) => eyeOpenRatio(L) < T.BLINK_MAX,
      },
      {
        key: "left",
        label: pick([
          "Turn your head a little LEFT",
          "Look slightly to your LEFT",
          "Face a bit to the LEFT",
        ]),
        check: (L) => yaw(L) < -T.YAW_ABS,
      },
      {
        key: "right",
        label: pick([
          "Turn your head a little RIGHT",
          "Look slightly to your RIGHT",
          "Face a bit to the RIGHT",
        ]),
        check: (L) => yaw(L) > T.YAW_ABS,
      },
      {
        key: "open",
        label: pick([
          "Open your mouth",
          "Say 'ah' (open mouth)",
          "Open your mouth slightly",
        ]),
        check: (L) => mouthOpen(L) > T.MOUTH_MIN,
      },
    ],
    [T]
  );

  // Shuffle + random length (75% pick 3 steps, else 4)
  const chosen = useMemo(() => {
    const arr = [...stepsPool];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const len = Math.random() < 0.75 ? 3 : 4;
    return arr.slice(0, len);
  }, [stepsPool]);

  const [passed, setPassed] = useState({}); // {blink:true, ...}
  const allPassed = chosen.every((s) => passed[s.key]);
  const currentIdx = chosen.findIndex((s) => !passed[s.key]);
  const current = currentIdx === -1 ? null : chosen[currentIdx];

  useEffect(() => {
    (async () => {
      try {
        await loadScriptOnce("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js","mp-facemesh");
        await loadScriptOnce("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js","mp-camera");
        await loadScriptOnce("https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js","mp-draw");

        const v = videoRef.current;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
        });
        streamRef.current = stream;
        v.srcObject = stream;
        await v.play();

        const FaceMesh = window.faceMesh || window;
        const fm = new FaceMesh.FaceMesh({
          locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
        });
        fm.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        faceMeshRef.current = fm;

        fm.onResults(onResults);
        const cam = new window.Camera(v, {
          onFrame: async () => fm.send({ image: v }),
          width: 640,
          height: 480,
        });
        cam.start();
      } catch (e) {
        console.error(e);
        setError("Camera/model failed. Use the Upload button if this persists.");
      }
    })();

    return () => {
      try {
        const s = streamRef.current;
        if (s) s.getTracks().forEach((t) => t.stop());
      } catch {}
    };
  }, []);

  function onResults(results) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");

    // Mirror like a selfie
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    const L = results.multiFaceLandmarks?.[0];
    setLandmarks(L || null);
    if (!L) return;

    // Evaluate current step only (prevents accidental pass of later steps)
    if (current && current.check(L)) {
      setPassed((p) => (p[current.key] ? p : { ...p, [current.key]: true }));
    }

    // HUD
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, canvas.width, 34);
    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui, sans-serif";

    const msg = allPassed
      ? "Liveness checks passed ✓"
      : `${currentIdx + 1}/${chosen.length}: ${current?.label || ""}`;
    ctx.fillText(msg, 10, 20);
  }

  async function captureAndUpload() {
    if (!allPassed) return;
    try {
      const canvas = canvasRef.current;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
      const form = new FormData();
      form.append("file", dataUrl);
      form.append("upload_preset", UPLOAD_PRESET);
      form.append("folder", "kpocha/pro-apps/selfies");

      const r = await fetch(url, { method: "POST", body: form });
      if (!r.ok) throw new Error("Upload failed");
      const j = await r.json();
      if (!j?.secure_url) throw new Error("No URL in upload response");
      onUploaded?.(j.secure_url);
      onClose?.();
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to upload selfie. Try again or use the Upload button.");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 grid place-items-center p-4">
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="font-semibold">Liveness Check</div>
          <button onClick={onClose} className="text-sm text-zinc-400 hover:text-white">Close</button>
        </div>

        <div className="p-4 space-y-3">
          {error && <div className="text-sm text-red-400">{error}</div>}

          <div className="rounded-lg overflow-hidden border border-zinc-800">
            <video ref={videoRef} autoPlay playsInline muted style={{ display: "none" }} />
            <canvas ref={canvasRef} className="w-full h-auto block" />
          </div>

          <div className="text-sm grid grid-cols-2 gap-2">
            {chosen.map((s, i) => (
              <div key={s.key}>
                {i + 1}. {s.label}: {passed[s.key] ? "✅" : "⏳"}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              className="px-3 py-2 rounded-lg border border-zinc-700 text-sm disabled:opacity-50"
              onClick={captureAndUpload}
              disabled={!allPassed || !CLOUD_NAME || !UPLOAD_PRESET}
              title={allPassed ? "Capture & upload selfie" : "Finish prompts to continue"}
            >
              {allPassed ? "Capture & Upload Selfie" : "Complete prompts to continue"}
            </button>
            {(!CLOUD_NAME || !UPLOAD_PRESET) && (
              <div className="text-xs text-amber-400">
                Set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Face utilities (MediaPipe landmark indices) ---- */
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function eyeOpenRatio(L) {
  // Left: 159(top),145(bot), 33(inner),133(outer)
  // Right: 386,374,362,263
  const lTop=L[159], lBot=L[145], lIn=L[33], lOut=L[133];
  const rTop=L[386], rBot=L[374], rIn=L[362], rOut=L[263];
  const left = dist(lTop,lBot) / Math.max(dist(lIn,lOut), 1e-6);
  const right = dist(rTop,rBot) / Math.max(dist(rIn,rOut), 1e-6);
  return (left + right) / 2;
}
function eyeClosed(L){ return eyeOpenRatio(L) < 0.18; }
function yaw(L) {
  // nose 1, cheeks 234/454
  const nose=L[1], lc=L[234], rc=L[454];
  const w = Math.max(dist(lc, rc), 1e-6);
  return (nose.x - ((lc.x + rc.x)/2)) / w; // -left, +right
}
function mouthOpen(L) {
  // vertical / horizontal ratio; 13/14 are inner lips midpoints, 61/291 corners
  const up=L[13], low=L[14], lc=L[61], rc=L[291];
  const v = dist(up, low), h = Math.max(dist(lc, rc), 1e-6);
  return v / h; // > ~0.32 indicates open mouth
}

export default function BecomePro() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // --------- Sections state ---------
  const [identity, setIdentity] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    gender: "",
    dob: "",
    phone: "",
    whatsapp: "",
    email: "",
    state: "",
    lga: "",
    originState: "",
    photoUrl: "",
    lat: "",
    lon: "",
  });
  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState(null);

  const [professional, setProfessional] = useState({
    services: [],
    years: "",
    workPhotos: [""],
    hasCert: "no",
    certUrl: "",
    profileVisible: true,
    nationwide: false,
  });

  const [business, setBusiness] = useState({
    mode: "shop",
    shopName: "",
    shopAddress: "",
    shopPhotoOutside: "",
    shopPhotoInside: "",
    lat: "",
    lon: "",
  });

  const [availability, setAvailability] = useState({
    days: { Mon:false, Tue:false, Wed:false, Thu:false, Fri:false, Sat:false, Sun:false },
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
    selfieWithIdUrl: "",
  });

  const [bank, setBank] = useState({
    bankName: "",
    accountName: "",
    accountNumber: "",
    bvn: "",
  });

  const [portfolio, setPortfolio] = useState({
    instagram: "",
    tiktok: "",
    facebook: "",
    website: "",
    testimonials: "",
  });

  // ✅ Only two checkboxes now
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

  // ---------- Cloudinary widget
  const [widgetReady, setWidgetReady] = useState(!!window.cloudinary?.createUploadWidget);
  useEffect(() => {
    if (widgetReady) return;
    if (!document.querySelector('script[data-cld="1"]')) {
      const s = document.createElement("script");
      s.src = "https://widget.cloudinary.com/v2.0/global/all.js";
      s.async = true;
      s.defer = true;
      s.setAttribute("data-cld", "1");
      s.onload = () => setWidgetReady(!!window.cloudinary?.createUploadWidget);
      document.body.appendChild(s);
    }
    const poll = setInterval(() => {
      if (window.cloudinary?.createUploadWidget) {
        setWidgetReady(true);
        clearInterval(poll);
      }
    }, 200);
    const timeout = setTimeout(() => clearInterval(poll), 10000);
    return () => { clearInterval(poll); clearTimeout(timeout); };
  }, [widgetReady]);

  const widgetFactory = useMemo(() => {
    return (onSuccess) => {
      if (!widgetReady || !CLOUD_NAME || !UPLOAD_PRESET) return null;
      try {
        return window.cloudinary.createUploadWidget(
          {
            cloudName: CLOUD_NAME,
            uploadPreset: UPLOAD_PRESET,
            multiple: false,
            maxFiles: 1,
            clientAllowedFormats: ["jpg","jpeg","png","webp"],
            maxImageFileSize: 5 * 1024 * 1024,
            sources: ["local", "camera", "url"],
            showPoweredBy: false,
            folder: "kpocha/pro-apps",
          },
          (err, res) => {
            if (!err && res && res.event === "success") onSuccess(res.info.secure_url);
          }
        );
      } catch {
        return null;
      }
    };
  }, [widgetReady]);

  // Helpers
  const toggleService = (name) =>
    setProfessional((p) => {
      const has = p.services.includes(name);
      return { ...p, services: has ? p.services.filter(s => s!==name) : [...p.services, name] };
    });

  const toggleDay = (key) =>
    setAvailability((p) => ({ ...p, days: { ...p.days, [key]: !p.days[key] }}));

  const toggleStateCovered = (st) =>
    setAvailability((p) => {
      const has = p.statesCovered.includes(st);
      return { ...p, statesCovered: has ? p.statesCovered.filter(x=>x!==st) : [...p.statesCovered, st] };
    });

  // Pull states list
  const [allStates, setAllStates] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/api/geo/ng");
        if (!alive) return;
        setAllStates(Array.isArray(data?.states) ? data.states : []);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);
  const stateList = useMemo(() => (allStates || []).slice().sort(), [allStates]);

  // ✅ canSubmit includes only required fields and terms/privacy
  const canSubmit =
    identity.firstName &&
    identity.lastName &&
    identity.gender &&
    identity.dob &&
    identity.phone &&
    identity.state &&
    (professional.nationwide || identity.lga) &&
    identity.photoUrl &&
    professional.services.length > 0 &&
    verification.idType &&
    verification.idUrl &&
    verification.selfieWithIdUrl &&
    bank.bankName &&
    bank.accountName &&
    bank.accountNumber &&
    bank.bvn &&
    agreements.terms &&
    agreements.privacy;

  function digitsOnly(s = "") { return String(s).replace(/\D/g, ""); }

  /* -------- GPS: Use my location -------- */
  async function useMyLocation() {
    try {
      setMsg("");
      if (!("geolocation" in navigator)) {
        setMsg("Your browser does not support geolocation.");
        return;
      }
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      }).then(async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lon = Number(pos.coords.longitude.toFixed(6));

        setBusiness((b) => ({ ...b, lat, lon }));
        setIdentity((i) => ({ ...i, lat, lon }));

        try {
          const { data } = await api.get(`/api/geo/rev?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
          const props = data?.features?.[0]?.properties || {};
          const guessedState = String(props.state || props.region || "").toUpperCase();
          const guessedLga = String(props.county || props.city || props.district || props.suburb || "").toUpperCase();
          const formatted = props.formatted || "";

          setIdentity((prev) => ({
            ...prev,
            state: prev.state || guessedState || prev.state,
            lga: prev.lga || guessedLga || prev.lga,
          }));

          setBusiness((prev) => ({
            ...prev,
            shopAddress: prev.shopAddress || formatted || prev.shopAddress,
          }));
        } catch {}
      });
    } catch (err) {
      setMsg(err?.message || "Failed to get your location.");
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setMsg("");
    try {
      const topLat = business.lat || identity.lat || "";
      const topLon = business.lon || identity.lon || "";

      const payload = {
        ...(topLat && topLon ? { lat: topLat, lon: topLon } : {}),
        identity: { ...identity, ...(topLat && topLon ? { lat: topLat, lon: topLon } : {}) },
        professional,
        business: { ...business, ...(topLat && topLon ? { lat: topLat, lon: topLon } : {}) },
        availability: { ...availability, statesCovered: professional.nationwide ? stateList : availability.statesCovered },
        pricing,
        verification: { ...verification, ...(phoneVerifiedAt ? { phoneVerifiedAt } : {}) },
        bank: { ...bank, accountNumber: digitsOnly(bank.accountNumber).slice(0, 10), bvn: digitsOnly(bank.bvn).slice(0, 11) },
        portfolio,
        ...(phoneVerifiedAt ? { phoneVerifiedAt } : {}),
        status: "submitted",
        acceptedTerms: !!agreements.terms,
        acceptedPrivacy: !!agreements.privacy,
        agreements: { terms: !!agreements.terms, privacy: !!agreements.privacy },
      };

      // First-time apply: POST /api/applications
      await submitProApplication(payload);
      nav("/apply/thanks");
    } catch (err) {
      const apiMsg =
        err?.response?.data?.error ||
        (err?.response?.status === 409
          ? "You already have an active or pending application."
          : "Failed to submit application.");
      setMsg(apiMsg);
    } finally {
      setBusy(false);
    }
  }

  const [showLive, setShowLive] = useState(false);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h2 className="text-2xl font-semibold mb-6">Professional Application</h2>
      {msg && <div className="mb-4 text-sm text-red-400">{msg}</div>}

      <form onSubmit={submit} className="space-y-8">
        {/* SECTION 1: Identity & Contact */}
        <Section title="Identity & Contact" id="identity">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="First Name" value={identity.firstName} onChange={(e)=>setIdentity({...identity, firstName: e.target.value})} required />
            <Input label="Middle Name" value={identity.middleName} onChange={(e)=>setIdentity({...identity, middleName: e.target.value})} />
            <Input label="Last Name" value={identity.lastName} onChange={(e)=>setIdentity({...identity, lastName: e.target.value})} required />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Select label="Gender" value={identity.gender} onChange={(e)=>setIdentity({...identity, gender: e.target.value})}
              options={["Male","Female","Other"]} required />
            <Input label="Date of Birth" type="date" value={identity.dob} onChange={(e)=>setIdentity({...identity, dob: e.target.value})} required />
            <Input label="Email" type="email" value={identity.email} onChange={(e)=>setIdentity({...identity, email: e.target.value})} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div>
              <Label>Phone Number</Label>
              <input
                className="w-full bg-black border border-zinc-800 rounded-lg px3 py-2"
                value={identity.phone}
                onChange={(e)=>{ setIdentity({...identity, phone: e.target.value}); setPhoneVerifiedAt(null); }}
                required
              />
              <PhoneOTP phone={identity.phone} disabled={!identity.phone} onVerified={(iso)=>setPhoneVerifiedAt(iso)} />
              {phoneVerifiedAt && <div className="text-xs text-emerald-300 mt-1">Verified</div>}
            </div>
            <Input label="WhatsApp (optional)" value={identity.whatsapp} onChange={(e)=>setIdentity({...identity, whatsapp: e.target.value})} />
            <div>
              <Label>Profile Photo</Label>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                  placeholder="Photo URL"
                  value={identity.photoUrl}
                  onChange={(e)=>setIdentity({...identity, photoUrl: e.target.value})}
                />
                <UploadButton
                  title={widgetReady ? "Upload" : "Upload (loading…)"}
                  onUploaded={(url)=>setIdentity({...identity, photoUrl: url})}
                  widgetFactory={widgetFactory}
                  disabled={!widgetReady}
                />
              </div>
            </div>
          </div>

          {/* State/LGA via dynamic picker */}
          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={professional.nationwide}
                onChange={(e)=>setProfessional({...professional, nationwide: e.target.checked})}
              />
              Offer services nationwide (Nigeria)
            </label>

            <NgGeoPicker
              valueState={identity.state}
              onChangeState={(st) => {
                setIdentity({ ...identity, state: st, lga: "" });
                if (st && !professional.nationwide) {
                  setAvailability((p)=>({
                    ...p,
                    statesCovered: p.statesCovered.includes(st) ? p.statesCovered : [...p.statesCovered, st]
                  }));
                }
              }}
              valueLga={identity.lga}
              onChangeLga={(lga) => setIdentity({ ...identity, lga })}
              required
              className="grid grid-cols-1 gap-3"
            />

            {!professional.nationwide && (
              <div className="text-sm">
                <Label>States you cover</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-auto p-2 border border-zinc-800 rounded">
                  {stateList.map((st) => (
                    <label key={st} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={availability.statesCovered.includes(st)}
                        onChange={()=>toggleStateCovered(st)}
                      />
                      {st}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* SECTION 2: Professional Details */}
        <Section title="Professional Details" id="professional">
          <div className="flex items-center justify-between mb-2">
            <Label>What service do you offer?</Label>
            <label className="text-xs flex items-center gap-2">
              <input
                type="checkbox"
                checked={professional.profileVisible}
                onChange={(e)=>setProfessional({...professional, profileVisible: e.target.checked})}
              />
              Profile visible in search
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SERVICE_OPTIONS.map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={professional.services.includes(opt)}
                  onChange={() => toggleService(opt)}
                />
                {opt}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Select
              label="Years of Experience"
              value={professional.years}
              onChange={(e)=>setProfessional({...professional, years: e.target.value})}
              options={["0–1 year","2–4 years","5–10 years","10+ years"]}
            />
            <Select
              label="Any certification?"
              value={professional.hasCert}
              onChange={(e)=>setProfessional({...professional, hasCert: e.target.value})}
              options={["no","yes"]}
            />
            {professional.hasCert === "yes" && (
              <div>
                <Label>Certificate</Label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                    placeholder="Certificate URL"
                    value={professional.certUrl}
                    onChange={(e)=>setProfessional({...professional, certUrl: e.target.value})}
                  />
                  <UploadButton
                    title={widgetReady ? "Upload" : "Upload (loading…)"}
                    onUploaded={(url)=>setProfessional({...professional, certUrl: url})}
                    widgetFactory={widgetFactory}
                    disabled={!widgetReady}
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
                  className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                  placeholder={`Photo URL ${idx+1}`}
                  value={u}
                  onChange={(e)=>{
                    const arr=[...professional.workPhotos]; arr[idx]=e.target.value;
                    setProfessional({...professional, workPhotos: arr});
                  }}
                />
                <UploadButton
                  title={widgetReady ? "Upload" : "Upload (loading…)"}
                  onUploaded={(url)=>{
                    const arr=[...professional.workPhotos]; arr[idx]=url;
                    setProfessional({...professional, workPhotos: arr});
                  }}
                  widgetFactory={widgetFactory}
                  disabled={!widgetReady}
                />
                {idx>0 && (
                  <button
                    type="button"
                    className="text-sm text-red-400"
                    onClick={()=> setProfessional({...professional, workPhotos: professional.workPhotos.filter((_,i)=>i!==idx)})}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="text-sm text-gold underline"
              onClick={()=>setProfessional({...professional, workPhotos:[...professional.workPhotos, ""]})}>
              + Add another
            </button>
          </div>
        </Section>

        {/* SECTION 3: Business */}
        <Section title="Business Information" id="business">
          <Select
            label="Work Mode"
            value={business.mode}
            onChange={(e)=>setBusiness({...business, mode: e.target.value})}
            options={["shop","home","both"]}
          />
          {(business.mode === "shop" || business.mode === "both") && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <Input label="Business / Shop Name" value={business.shopName} onChange={(e)=>setBusiness({...business, shopName: e.target.value})} />
              <Input label="Business Address" value={business.shopAddress} onChange={(e)=>setBusiness({...business, shopAddress: e.target.value})} />
              <div>
                <Label>Photo (outside)</Label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                    placeholder="URL"
                    value={business.shopPhotoOutside}
                    onChange={(e)=>setBusiness({...business, shopPhotoOutside: e.target.value})}
                  />
                  <UploadButton
                    title={widgetReady ? "Upload" : "Upload (loading…)"}
                    onUploaded={(url)=>setBusiness({...business, shopPhotoOutside: url})}
                    widgetFactory={widgetFactory}
                    disabled={!widgetReady}
                  />
                </div>
              </div>
              <div>
                <Label>Photo (inside)</Label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                    placeholder="URL"
                    value={business.shopPhotoInside}
                    onChange={(e)=>setBusiness({...business, shopPhotoInside: e.target.value})}
                  />
                  <UploadButton
                    title={widgetReady ? "Upload" : "Upload (loading…)"}
                    onUploaded={(url)=>setBusiness({...business, shopPhotoInside: url})}
                    widgetFactory={widgetFactory}
                    disabled={!widgetReady}
                  />
                </div>
              </div>
            </div>
          )}

          {/* GPS helpers */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Latitude (optional)"
              value={business.lat}
              onChange={(e)=>setBusiness({...business, lat: e.target.value})}
              placeholder="e.g. 6.5244"
            />
            <Input
              label="Longitude (optional)"
              value={business.lon}
              onChange={(e)=>setBusiness({...business, lon: e.target.value})}
              placeholder="e.g. 3.3792"
            />
            <div className="flex items-end">
              <button
                type="button"
                onClick={useMyLocation}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
                title="Fill GPS from your current location"
              >
                Use my location
              </button>
            </div>
            {(business.lat && business.lon) && (
              <div className="md:col-span-3 text-xs text-zinc-400">
                Tip: Your GPS helps clients find you in “nearby” search.
              </div>
            )}
          </div>
        </Section>

        {/* SECTION 4: Availability */}
        <Section title="Work Availability" id="availability">
          <Label>Working Days</Label>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 text-sm">
            {Object.keys(availability.days).map((d) => (
              <label key={d} className="flex items-center gap-2">
                <input type="checkbox" checked={availability.days[d]} onChange={()=>toggleDay(d)} />
                {d}
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 md-grid-cols-3 md:grid-cols-3 gap-3 mt-3">
            <Input label="Start time" type="time" value={availability.start} onChange={(e)=>setAvailability({...availability, start: e.target.value})} />
            <Input label="End time" type="time" value={availability.end} onChange={(e)=>setAvailability({...availability, end: e.target.value})} />
            <Select label="Emergency service?" value={availability.emergency} onChange={(e)=>setAvailability({...availability, emergency:e.target.value})} options={["no","yes"]} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Select label="Home service?" value={availability.homeService} onChange={(e)=>setAvailability({...availability, homeService:e.target.value})} options={["no","yes"]} />
            {availability.homeService === "yes" && (
              <Input label="Home service starting price (₦)" value={availability.homeServicePrice} onChange={(e)=>setAvailability({...availability, homeServicePrice: e.target.value})}/>
            )}
          </div>
        </Section>

        {/* SECTION 5: Pricing (optional) */}
        <Section title="Pricing (optional)" id="pricing">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Men’s Cut (₦)" value={pricing.menCut} onChange={(e)=>setPricing({...pricing, menCut: e.target.value})}/>
            <Input label="Women’s Cut (₦)" value={pricing.womenCut} onChange={(e)=>setPricing({...pricing, womenCut: e.target.value})}/>
            <Input label="Dreadlock (₦)" value={pricing.locs} onChange={(e)=>setPricing({...pricing, locs: e.target.value})}/>
            <Input label="Manicure (₦)" value={pricing.manicure} onChange={(e)=>setPricing({...pricing, manicure: e.target.value})}/>
            <Input label="Pedicure (₦)" value={pricing.pedicure} onChange={(e)=>setPricing({...pricing, pedicure: e.target.value})}/>
          </div>
          <textarea
            className="w-full mt-3 bg-black border border-zinc-800 rounded-lg px-3 py-2"
            placeholder="Other services & prices"
            value={pricing.otherServices}
            onChange={(e)=>setPricing({...pricing, otherServices: e.target.value})}
          />
        </Section>

        {/* SECTION 6: Identity Verification */}
        <Section title="Identity Verification" id="verification">
          <Select label="ID Type" value={verification.idType} onChange={(e)=>setVerification({...verification, idType: e.target.value})}
            options={["National ID","Voter’s Card","Driver’s License","International Passport"]} required />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div>
              <Label>Government ID</Label>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                  placeholder="ID Image URL"
                  value={verification.idUrl}
                  onChange={(e)=>setVerification({...verification, idUrl: e.target.value})}
                />
                <UploadButton
                  title={widgetReady ? "Upload" : "Upload (loading…)"}
                  onUploaded={(url)=>setVerification({...verification, idUrl: url})}
                  widgetFactory={widgetFactory}
                  disabled={!widgetReady}
                />
              </div>
            </div>
            <div>
              <Label>Selfie holding ID</Label>
              <div className="flex gap-2 flex-wrap">
                <input
                  className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2"
                  placeholder="Selfie Image URL"
                  value={verification.selfieWithIdUrl}
                  onChange={(e)=>setVerification({...verification, selfieWithIdUrl: e.target.value})}
                />
                <UploadButton
                  title={widgetReady ? "Upload" : "Upload (loading…)"}
                  onUploaded={(url)=>setVerification({...verification, selfieWithIdUrl: url})}
                  widgetFactory={widgetFactory}
                  disabled={!widgetReady}
                />
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border border-emerald-700 text-sm hover:bg-emerald-900/30"
                  onClick={()=>setShowLive(true)}
                  title="Open liveness camera (randomized prompts)"
                >
                  Liveness Selfie (Random)
                </button>
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                Complete the randomized prompts, then we’ll capture and upload a selfie automatically.
              </p>
            </div>
          </div>
        </Section>

        {/* SECTION 7: Bank Details */}
        <Section title="Bank Details" id="bank">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Bank Name" value={bank.bankName} onChange={(e)=>setBank({...bank, bankName: e.target.value})} required />
            <Input label="Account Name" value={bank.accountName} onChange={(e)=>setBank({...bank, accountName: e.target.value})} required />
            <Input
              label="Account Number"
              value={bank.accountNumber}
              onChange={(e)=>setBank({...bank, accountNumber: digitsOnly(e.target.value).slice(0,10)})}
              required
            />
            <Input
              label="BVN (required)"
              value={bank.bvn}
              onChange={(e)=>setBank({...bank, bvn: digitsOnly(e.target.value).slice(0,11)})}
              required
            />
          </div>
        </Section>

        {/* SECTION 8: Social / Portfolio */}
        <Section title="Social Proof / Portfolio" id="portfolio">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Instagram" value={portfolio.instagram} onChange={(e)=>setPortfolio({...portfolio, instagram: e.target.value})} />
            <Input label="TikTok" value={portfolio.tiktok} onChange={(e)=>setPortfolio({...portfolio, tiktok: e.target.value})} />
            <Input label="Facebook" value={portfolio.facebook} onChange={(e)=>setPortfolio({...portfolio, facebook: e.target.value})} />
            <Input label="Website / Portfolio" value={portfolio.website} onChange={(e)=>setPortfolio({...portfolio, website: e.target.value})} />
          </div>
          <textarea
            className="w-full mt-3 bg-black border border-zinc-800 rounded-lg px-3 py-2"
            placeholder="Testimonials / Reviews"
            value={portfolio.testimonials}
            onChange={(e)=>setPortfolio({...portfolio, testimonials: e.target.value})}
          />
        </Section>

        {/* SECTION 9: Agreements (only two) */}
        <Section title="User Agreements" id="agreements">
          <div className="space-y-2 text-sm">
            <Check
              label={<>I have read and agree to the <a className="text-gold underline" href="/legal#terms" target="_blank" rel="noreferrer">Terms &amp; Conditions</a></>}
              checked={agreements.terms}
              onChange={()=>setAgreements({...agreements, terms: !agreements.terms})}
            />
            <Check
              label={<>I have read and agree to the <a className="text-gold underline" href="/legal#privacy" target="_blank" rel="noreferrer">Privacy Policy</a></>}
              checked={agreements.privacy}
              onChange={()=>setAgreements({...agreements, privacy: !agreements.privacy})}
            />
          </div>
        </Section>

        {/* FINAL STEP */}
        <button
          disabled={!canSubmit || busy}
          className="w-full bg-gold text-black font-semibold rounded-lg py-2 disabled:opacity-60"
        >
          {busy ? "Submitting..." : "Submit Application"}
        </button>
      </form>

      {showLive && (
        <LivenessModal
          onClose={()=>setShowLive(false)}
          onUploaded={(url)=>{
            // write to the same key your payload already uses
            setVerification((v)=>({ ...v, selfieWithIdUrl: url }));
            setShowLive(false);
          }}
        />
      )}
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
function Label({ children }) { return <div className="text-sm text-zinc-300 mb-1">{children}</div>; }
function Input({ label, required, ...props }) {
  return (
    <label className="block">
      <Label>{label}{required ? " *" : ""}</Label>
      <input {...props} className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2" />
    </label>
  );
}
function Select({ label, options=[], required, ...props }) {
  return (
    <label className="block">
      <Label>{label}{required ? " *" : ""}</Label>
      <select {...props} className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2">
        <option value="">{required ? "Select…" : "Select (optional)…"}</option>
        {options.map((o)=> <option key={o} value={o}>{o}</option>)}
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
function UploadButton({ title="Upload", onUploaded, widgetFactory, disabled }) {
  function open() {
    const widget = widgetFactory?.(onUploaded);
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
      className="px-3 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900 disabled:opacity-50"
      title="Upload with Cloudinary"
    >
      {title}
    </button>
  );
}
