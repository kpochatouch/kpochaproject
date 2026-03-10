//apps/web/src/components/MediaUploader.jsx
import { useEffect, useRef, useState } from "react";
import { uploadMediaAsset } from "../lib/r2Upload";

export default function MediaUploader({
  api,
  valueUrl = "",
  valueAssetId = "",
  type = "image",
  visibility = "private",
  onChange,
  label = "Add Photo",
  onPreviewClick,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showOptions, setShowOptions] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const wrapperRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) {
        setShowOptions(false);
      }
    }

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  function stopCameraStream() {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }

  async function handleFile(file) {
    if (!file) return;

    setBusy(true);
    setError("");
    setShowOptions(false);

    try {
      let localPreviewUrl = "";
      try {
        localPreviewUrl = URL.createObjectURL(file);
      } catch {
        localPreviewUrl = "";
      }

      const res = await uploadMediaAsset({
        api,
        file,
        type,
        visibility,
      });

      onChange?.({
        previewUrl: localPreviewUrl,
        assetId: res?.assetId || "",
      });
    } catch (e) {
      setError(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function openDesktopCamera() {
    setError("");
    setCameraError("");
    setShowOptions(false);

    if (type !== "image") {
      cameraInputRef.current?.click();
      return;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setError("This browser does not support direct camera access here.");
      return;
    }

    try {
      stopCameraStream();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });

      streamRef.current = stream;
      setCameraOpen(true);

      setTimeout(() => {
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video
            .play()
            .then(() => {
              setCameraReady(true);
            })
            .catch(() => {
              setCameraError("Could not start camera preview.");
            });
        }
      }, 0);
    } catch (e) {
      setError(
        e?.message ||
          "Camera access was blocked or no camera device was found.",
      );
    }
  }

  function closeDesktopCamera() {
    stopCameraStream();
    setCameraOpen(false);
    setCameraBusy(false);
    setCameraError("");
  }

  async function captureFromCamera() {
    if (!videoRef.current || !canvasRef.current || cameraBusy) return;

    setCameraBusy(true);
    setCameraError("");

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Camera canvas could not start.");
      }

      ctx.drawImage(video, 0, 0, width, height);

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );

      if (!blob) {
        throw new Error("Could not capture photo.");
      }

      const file = new File([blob], `camera-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });

      closeDesktopCamera();
      await handleFile(file);
    } catch (e) {
      setCameraError(e?.message || "Camera capture failed.");
      setCameraBusy(false);
    }
  }

  return (
    <div className="space-y-3" ref={wrapperRef}>
      {type === "image" ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (valueUrl && onPreviewClick) onPreviewClick();
            }}
            className="relative w-16 h-16 rounded-full border border-zinc-800 overflow-hidden shrink-0 bg-zinc-900"
            title={valueUrl ? "Click to expand" : "No photo"}
          >
            {valueUrl ? (
              <img
                src={valueUrl}
                alt={label}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[11px] text-zinc-500">
                No Photo
              </div>
            )}
          </button>

          <div className="min-w-0">
            <div className="text-sm text-zinc-200">
              {valueAssetId ? "Photo selected" : "No photo selected"}
            </div>
            <div className="text-xs text-zinc-500">
              {busy ? "Uploading..." : "Choose how you want to upload below"}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {valueUrl ? (
            <video
              src={valueUrl}
              className="w-40 h-24 rounded-lg border border-zinc-800 object-cover bg-zinc-900"
              controls
            />
          ) : (
            <div className="w-40 h-24 rounded-lg border border-zinc-800 bg-zinc-900 flex items-center justify-center text-xs text-zinc-500">
              No video selected
            </div>
          )}
        </div>
      )}

      <div className="relative inline-block">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError("");
            setShowOptions((prev) => !prev);
          }}
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-yellow-500 text-yellow-300 text-sm hover:bg-yellow-500/10 disabled:opacity-50"
        >
          {busy ? "Uploading..." : valueAssetId ? `Change ${label}` : label}
        </button>

        {showOptions && !busy ? (
          <div className="absolute left-0 mt-2 z-20 min-w-[220px] rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl p-2 space-y-1">
            <button
              type="button"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-900 text-left text-sm text-zinc-200"
              onClick={openDesktopCamera}
            >
              <span className="text-base">📷</span>
              <span>Camera</span>
            </button>

            <button
              type="button"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-900 text-left text-sm text-zinc-200"
              onClick={() => {
                setShowOptions(false);
                fileInputRef.current?.click();
              }}
            >
              <span className="text-base">📁</span>
              <span>File Picker</span>
            </button>
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept={type === "video" ? "video/*" : "image/*"}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            handleFile(file);
          }}
        />

        <input
          ref={cameraInputRef}
          type="file"
          accept={type === "video" ? "video/*" : "image/*"}
          capture={type === "video" ? "environment" : "user"}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            handleFile(file);
          }}
        />
      </div>

      {error ? <div className="text-xs text-red-400">{error}</div> : null}

      {cameraOpen ? (
        <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-100">
                Capture Photo
              </h3>
              <button
                type="button"
                onClick={closeDesktopCamera}
                className="text-sm text-zinc-400 hover:text-zinc-200"
              >
                Close
              </button>
            </div>

            <div className="rounded-xl overflow-hidden border border-zinc-800 bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-auto max-h-[70vh] object-cover"
              />
            </div>

            <canvas ref={canvasRef} className="hidden" />

            {cameraError ? (
              <div className="mt-3 text-xs text-red-400">{cameraError}</div>
            ) : null}

            {!cameraReady && !cameraError ? (
              <div className="mt-3 text-xs text-zinc-500">
                Starting camera...
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDesktopCamera}
                className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-200 hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={captureFromCamera}
                disabled={!cameraReady || cameraBusy}
                className="px-4 py-2 rounded-lg border border-yellow-500 text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-50"
              >
                {cameraBusy ? "Capturing..." : "Capture Photo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
