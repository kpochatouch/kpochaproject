// apps/web/src/pages/LivenessPage.jsx
import { useEffect, useRef, useState } from "react";

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "";

export default function LivenessPage() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState({ blink: false, left: false, right: false });
  const [step, setStep] = useState(0);
  const [showDev, setShowDev] = useState(
    () => localStorage.debugSelfie === "1",
  );
  const clickCount = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        await load(
          "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js",
          "mp-face-mesh",
        );
        await load(
          "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js",
          "mp-cam-utils",
        );
        await load(
          "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js",
          "mp-draw-utils",
        );

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 960 },
            height: { ideal: 720 },
            // try to brighten where supported
            advanced: [{ exposureCompensation: 0.7, torch: false }],
          },
        });
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const FaceMesh = window.faceMesh || window;
        const fm = new FaceMesh.FaceMesh({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });
        fm.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        fm.onResults(onResults);
        const cam = new window.Camera(videoRef.current, {
          onFrame: async () => {
            await fm.send({ image: videoRef.current });
          },
          width: 960,
          height: 720,
        });
        cam.start();
      } catch (e) {
        setError(
          e?.message ||
            "Camera failed. Grant permission and ensure good lighting.",
        );
      }
    })();
    return () => {
      try {
        const s = videoRef.current?.srcObject;
        s && s.getTracks().forEach((t) => t.stop());
      } catch {}
    };
  }, []);

  function onResults(results) {
    const c = canvasRef.current,
      v = videoRef.current;
    if (!c || !v) return;
    c.width = v.videoWidth || 960;
    c.height = v.videoHeight || 720;
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(v, -c.width, 0, c.width, c.height);
    ctx.restore();

    const face = results.multiFaceLandmarks?.[0];
    if (!face) return;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const l_top = face[159],
      l_bot = face[145],
      l_in = face[33],
      l_out = face[133];
    const r_top = face[386],
      r_bot = face[374],
      r_in = face[362],
      r_out = face[263];
    const left_open = dist(l_top, l_bot) / (dist(l_in, l_out) || 1e-6);
    const right_open = dist(r_top, r_bot) / (dist(r_in, r_out) || 1e-6);
    const bothOpen = (left_open + right_open) / 2;

    const nose = face[1],
      leftCheek = face[234],
      rightCheek = face[454];
    const faceWidth = dist(leftCheek, rightCheek) || 1e-6;
    const yaw = (nose.x - (leftCheek.x + rightCheek.x) / 2) / faceWidth;

    const next = { ...ok };
    if (!ok.blink && bothOpen < 0.18) next.blink = true;
    if (!ok.left && yaw < -0.06) next.left = true;
    if (!ok.right && yaw > 0.06) next.right = true;
    setOk(next);
    setStep(!next.blink ? 0 : !next.left ? 1 : !next.right ? 2 : 3);

    // banner (yellow)
    ctx.fillStyle = "rgba(255, 204, 0, 0.25)";
    ctx.fillRect(0, 0, c.width, 38);
    ctx.fillStyle = "#FFCC00";
    ctx.font = "16px system-ui, sans-serif";
    const msg =
      step === 0
        ? "Blink slowly"
        : step === 1
          ? "Turn a little LEFT"
          : step === 2
            ? "Turn a little RIGHT"
            : "Liveness passed ✓";
    ctx.fillText(msg, 12, 24);
  }

  async function upload() {
    try {
      if (!CLOUD_NAME || !UPLOAD_PRESET) throw new Error("Cloudinary not set");
      const dataUrl = canvasRef.current.toDataURL("image/jpeg", 0.92);
      const form = new FormData();
      form.append("file", dataUrl);
      form.append("upload_preset", UPLOAD_PRESET);
      form.append("folder", "kpocha/pro-apps/selfies");
      const r = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
        { method: "POST", body: form },
      );
      const j = await r.json();
      if (!j?.secure_url) throw new Error("Upload failed");

      // ✅ Persist for BecomePro to consume
      const selfieUrl = j.secure_url;
      const metrics = {
        blink: !!ok.blink,
        turnLeft: !!ok.left,
        turnRight: !!ok.right,
        ts: new Date().toISOString(),
      };
      localStorage.setItem("kpocha:selfieUrl", selfieUrl);
      localStorage.setItem("kpocha:livenessMetrics", JSON.stringify(metrics));
      localStorage.setItem("kpocha:livenessVideoUrl", ""); // Optional reserved placeholder
      // Back-compat
      localStorage.lastSelfieUrl = selfieUrl;

      alert("Uploaded ✓");
      history.back(); // return to BecomePro
    } catch (e) {
      setError(e.message || "Upload failed");
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 bg-black text-yellow-300">
      <div className="flex items-center justify-between">
        <h1
          className="text-xl font-semibold select-none cursor-pointer"
          onClick={() => {
            if (++clickCount.current >= 3) {
              setShowDev(true);
              localStorage.debugSelfie = "1";
            }
          }}
          title="(triple-click to enable manual DEV fallback)"
        >
          Liveness Check
        </h1>
        <a
          href="/become"
          className="text-sm hover:text-white border-b border-yellow-500"
        >
          Back
        </a>
      </div>

      {error && <div className="mt-3 text-sm text-amber-400">{error}</div>}

      <div className="mt-3 rounded-lg overflow-hidden border border-yellow-600">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ display: "none" }}
        />
        <canvas ref={canvasRef} className="w-full h-auto block" />
      </div>

      <ul className="text-sm mt-3">
        <li>• Blink: {ok.blink ? "✅" : "⏳"}</li>
        <li>• Turn Left: {ok.left ? "✅" : "⏳"}</li>
        <li>• Turn Right: {ok.right ? "✅" : "⏳"}</li>
      </ul>

      <div className="flex items-center gap-2 mt-4">
        <button
          className="px-3 py-2 rounded-lg border border-yellow-600 text-yellow-300 hover:bg-yellow-600/10 text-sm disabled:opacity-50"
          onClick={upload}
          disabled={!(ok.blink && ok.left && ok.right)}
          title={
            !(ok.blink && ok.left && ok.right)
              ? "Complete the actions above first"
              : "Capture & upload"
          }
        >
          Capture & Upload Selfie
        </button>

        {showDev && <ManualSelfieFallback />}
      </div>
    </div>
  );
}

function ManualSelfieFallback() {
  const [val, setVal] = useState("");
  return (
    <div className="flex items-center gap-2">
      <input
        className="w-96 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-200 placeholder-zinc-500"
        placeholder="Manual selfie URL (DEV fallback)"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <button
        className="px-3 py-2 rounded-lg border border-yellow-600 text-yellow-300 hover:bg-yellow-600/10 text-sm"
        onClick={() => {
          const selfieUrl = val || "";
          localStorage.setItem("kpocha:selfieUrl", selfieUrl);
          localStorage.setItem(
            "kpocha:livenessMetrics",
            JSON.stringify({ ts: new Date().toISOString() }),
          );
          localStorage.setItem("kpocha:livenessVideoUrl", ""); // Optional reserved placeholder
          localStorage.lastSelfieUrl = selfieUrl; // back-compat
          alert("Saved manual selfie URL ✓");
          history.back();
        }}
      >
        Use this URL
      </button>
    </div>
  );
}

function load(src, id) {
  return new Promise((res, rej) => {
    if (id && document.getElementById(id)) return res();
    const s = document.createElement("script");
    if (id) s.id = id;
    s.src = src;
    s.async = true;
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}
