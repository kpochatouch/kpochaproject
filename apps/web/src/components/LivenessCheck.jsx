// apps/web/src/components/LivenessCheck.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

/** ======= Cloudinary (optional) =======
 * If these are set, the component uploads to Cloudinary automatically.
 * Otherwise it will return data URLs / blob URLs and still resolve.
 */
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "";

/** Small helper: load a remote <script> once by id */
function loadScriptOnce(src, id) {
  return new Promise((resolve, reject) => {
    if (id && document.getElementById(id)) return resolve();
    const s = document.createElement("script");
    if (id) s.id = id;
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/** Upload helpers (safe even if Cloudinary env not set) */
async function uploadImageOrReturn(dataUrl, folder) {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    return { url: dataUrl, via: "data-url" };
  }
  const form = new FormData();
  form.append("file", dataUrl);
  form.append("upload_preset", UPLOAD_PRESET);
  if (folder) form.append("folder", folder);
  const r = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: "POST", body: form },
  );
  if (!r.ok) throw new Error("Image upload failed");
  const j = await r.json();
  return { url: j.secure_url, via: "cloudinary" };
}

async function uploadVideoOrReturn(blob, folder) {
  if (!blob || !blob.size) return { url: "", via: "none" };
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    const url = URL.createObjectURL(blob);
    return { url, via: "blob-url" };
  }
  const form = new FormData();
  form.append("file", blob);
  form.append("upload_preset", UPLOAD_PRESET);
  if (folder) form.append("folder", folder);
  const r = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`,
    { method: "POST", body: form },
  );
  if (!r.ok) throw new Error("Video upload failed");
  const j = await r.json();
  return { url: j.secure_url, via: "cloudinary" };
}

/** ======= LivenessCheck (reusable modal) ======= */
export default function LivenessCheck({
  open = true,
  onClose,
  onPass,
  challenges = ["blink", "left", "right", "smile", "open"],
  count = 3,
  recordVideo = true,
  deadlineMsPerStep = 6000,
  uploadFolder = "kpocha/liveness",
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const faceMeshRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Randomize N challenges
  const steps = useMemo(() => {
    const pool = challenges.filter(Boolean);
    const out = [];
    while (out.length < Math.max(1, Math.min(count, pool.length))) {
      const i = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }, [challenges, count]);

  const [curIdx, setCurIdx] = useState(0);
  const [okMap, setOkMap] = useState({});
  const [deadline, setDeadline] = useState(null);

  // landmark metrics
  function analyze(face) {
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const lOpen =
      dist(face[159], face[145]) / (dist(face[33], face[133]) || 1e-6);
    const rOpen =
      dist(face[386], face[374]) / (dist(face[362], face[263]) || 1e-6);
    const eyeOpen = (lOpen + rOpen) / 2;

    const L = face[234],
      R = face[454],
      nose = face[1];
    const faceW = dist(L, R) || 1e-6;
    const yaw = (nose.x - (L.x + R.x) / 2) / faceW;

    const mouthOpen =
      dist(face[13], face[14]) / (dist(face[78], face[308]) || 1e-6);
    const smile =
      dist(face[61], face[291]) / (dist(face[78], face[308]) || 1e-6);

    return { eyeOpen, yaw, mouthOpen, smile };
  }

  function passFor(key, m) {
    switch (key) {
      case "blink":
        return m.eyeOpen < 0.18;
      case "left":
        return m.yaw < -0.06;
      case "right":
        return m.yaw > 0.06;
      case "open":
        return m.mouthOpen > 0.08;
      case "smile":
        return m.smile > 0.9;
      default:
        return false;
    }
  }

  function labelFor(key) {
    return (
      {
        blink: "Blink twice",
        left: "Turn your head LEFT",
        right: "Turn your head RIGHT",
        open: "Open your mouth",
        smile: "Smile slightly",
      }[key] || key
    );
  }

  // start camera
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        await loadScriptOnce(
          "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.min.js",
          "mp-face-mesh",
        );
        await loadScriptOnce(
          "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js",
          "mp-cam-utils",
        );

        const v = videoRef.current;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        v.srcObject = stream;
        await v.play();

        if (recordVideo) {
          try {
            const mr = new MediaRecorder(stream, {
              mimeType: "video/webm;codecs=vp8",
            });
            recRef.current = mr;
            chunksRef.current = [];
            mr.ondataavailable = (e) =>
              e.data?.size && chunksRef.current.push(e.data);
            mr.start();
          } catch (_) {
            /* optional */
          }
        }

        const FaceMesh = window.faceMesh || window;
        const fm = new FaceMesh.FaceMesh({
          locateFile: (f) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
        });
        fm.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        faceMeshRef.current = fm;

        fm.onResults((results) => {
          if (cancelled) return;
          drawAndCheck(results);
        });

        const cam = new window.Camera(videoRef.current, {
          onFrame: async () => {
            await faceMeshRef.current.send({ image: videoRef.current });
          },
          width: 640,
          height: 480,
        });
        cam.start();

        setCurIdx(0);
        setOkMap({});
        setDeadline(Date.now() + deadlineMsPerStep);
      } catch (e) {
        console.error(e);
        setError(
          "Camera permission or model loading failed. Please allow camera access or try again.",
        );
      }
    })();

    return () => {
      cancelled = true;
      try {
        recRef.current?.state !== "inactive" && recRef.current?.stop();
      } catch {}
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function drawAndCheck(results) {
    const canvas = canvasRef.current,
      video = videoRef.current;
    if (!canvas || !video) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");

    // mirrored video
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    // evaluate face
    const face = results.multiFaceLandmarks?.[0];
    if (!face) return;

    const metrics = analyze(face);
    const key = steps[curIdx];
    if (key && passFor(key, metrics)) {
      setOkMap((prev) => ({ ...prev, [key]: true }));
      const next = curIdx + 1;
      if (next < steps.length) {
        setCurIdx(next);
        setDeadline(Date.now() + deadlineMsPerStep);
      } else {
        setDeadline(null);
      }
    }

    // ===== overlay with STANDING OVAL =====
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const rx = canvas.width * 0.18; // narrow → not sleeping
    const ry = canvas.height * 0.34; // tall → standing egg

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
    ctx.restore();

    // white border
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // instruction
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.font = "16px system-ui, sans-serif";
    const msg = key ? `Do this: ${labelFor(key)}` : "Good ✓ Click Finish";
    const textW = ctx.measureText(msg).width;
    ctx.fillText(msg, cx - textW / 2, cy - ry + 30);
    ctx.restore();

    // timer
    if (deadline) {
      const remain = Math.max(0, deadline - Date.now());
      const pct = Math.min(1, remain / deadlineMsPerStep);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(
        canvas.width - Math.floor(pct * canvas.width),
        canvas.height - 6,
        Math.floor(pct * canvas.width),
        6,
      );
    }
  }

  async function finish() {
    try {
      setBusy(true);

      let videoBlob = null;
      if (recRef.current && recRef.current.state !== "inactive") {
        const wait = new Promise((res) => {
          recRef.current.onstop = res;
        });
        recRef.current.stop();
        await wait;
        videoBlob = new Blob(chunksRef.current, { type: "video/webm" });
      }

      const dataUrl = canvasRef.current.toDataURL("image/jpeg", 0.92);

      const [{ url: selfieUrl }, { url: videoUrl }] = await Promise.all([
        uploadImageOrReturn(dataUrl, `${uploadFolder}/selfies`),
        uploadVideoOrReturn(videoBlob, `${uploadFolder}/videos`),
      ]);

      const metrics = {
        steps,
        passed: Object.keys(okMap),
        cloudinary: Boolean(CLOUD_NAME && UPLOAD_PRESET),
      };

      onPass?.({ selfieUrl, videoUrl, metrics });
      onClose?.();
    } catch (e) {
      console.error(e);
      setError(e?.message || "Failed to finish liveness.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="font-semibold">Liveness Check</div>
          <button
            onClick={onClose}
            className="text-sm text-zinc-400 hover:text-white disabled:opacity-50"
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && <div className="text-sm text-red-400">{error}</div>}

          <div className="rounded-lg overflow-hidden border border-zinc-800">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ display: "none" }}
            />
            <canvas ref={canvasRef} className="w-full h-auto block" />
          </div>

          <ul className="text-sm grid grid-cols-1 sm:grid-cols-3 gap-1">
            {steps.map((k, i) => (
              <li key={k}>
                {okMap[k] ? "✅" : i === curIdx ? "⏳" : "•"} {labelFor(k)}
              </li>
            ))}
          </ul>

          {!CLOUD_NAME || !UPLOAD_PRESET ? (
            <div className="text-xs text-amber-400">
              Cloudinary env not set. Will return data/Blob URLs (still usable).
              Set <code>VITE_CLOUDINARY_CLOUD_NAME</code> and{" "}
              <code>VITE_CLOUDINARY_UPLOAD_PRESET</code> to enable uploads.
            </div>
          ) : null}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={finish}
              disabled={busy || Object.keys(okMap).length < steps.length}
              className="px-3 py-2 rounded-lg border border-emerald-700 text-sm hover:bg-emerald-900/30 disabled:opacity-50"
              title={
                Object.keys(okMap).length < steps.length
                  ? "Complete prompts first"
                  : "Finish & upload"
              }
            >
              {busy
                ? "Processing…"
                : Object.keys(okMap).length < steps.length
                  ? "Complete steps to continue"
                  : "Finish"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ======= Imperative opener ======= */
export function openLiveness(opts = {}) {
  return new Promise((resolve, reject) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);

    function cleanup() {
      setTimeout(() => {
        try {
          root.unmount();
        } catch {}
        host.remove();
      }, 0);
    }

    function handleClose() {
      cleanup();
      reject(new Error("closed"));
    }

    function handlePass(payload) {
      cleanup();
      resolve(payload);
    }

    root.render(
      <LivenessCheck
        open
        onClose={handleClose}
        onPass={handlePass}
        {...opts}
      />,
    );
  });
}
