//apps/web/src/components/ImageCropper.jsx
import React, { useCallback, useMemo, useState } from "react";
import Cropper from "react-easy-crop";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function getCroppedBlob(imageSrc, cropPixels, mime = "image/jpeg") {
  const img = await loadImage(imageSrc);

  const canvas = document.createElement("canvas");
  canvas.width = cropPixels.width;
  canvas.height = cropPixels.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  ctx.drawImage(
    img,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    cropPixels.width,
    cropPixels.height,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Crop failed"));
        resolve(blob);
      },
      mime,
      0.92,
    );
  });
}

export default function ImageCropperModal({
  open,
  src,
  onCancel,
  onDone,
  aspect = 1,
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_area, areaPixels) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const zoomVal = useMemo(() => clamp(zoom, 1, 5), [zoom]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-[#0b0c10] overflow-hidden">
        <div className="p-3 flex items-center justify-between border-b border-zinc-800">
          <div className="text-sm font-semibold text-white">Crop image</div>
          <button
            onClick={onCancel}
            className="text-xs text-zinc-300 hover:text-white"
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="relative w-full h-[60vh] bg-black">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoomVal}
            rotation={rotation}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="p-3 border-t border-zinc-800 space-y-3">
          <div className="flex items-center gap-3">
            <div className="text-xs text-zinc-300 w-14">Zoom</div>
            <input
              type="range"
              min="1"
              max="5"
              step="0.01"
              value={zoomVal}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full"
              disabled={busy}
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs text-zinc-300 w-14">Rotate</div>
            <input
              type="range"
              min="0"
              max="360"
              step="1"
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="w-full"
              disabled={busy}
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-white hover:bg-zinc-900"
              disabled={busy}
            >
              Cancel
            </button>

            <button
              onClick={async () => {
                if (!src || !croppedAreaPixels) return;
                setBusy(true);
                try {
                  const blob = await getCroppedBlob(src, croppedAreaPixels);
                  onDone(blob);
                } catch {
                  onCancel();
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg bg-gold text-black px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              disabled={busy || !croppedAreaPixels}
            >
              {busy ? "Cropping…" : "Use crop"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
