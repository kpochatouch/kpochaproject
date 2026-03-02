// apps/web/src/components/MediaUploader.jsx
import { useRef, useState } from "react";
import { uploadMediaAsset } from "../lib/r2Upload";

/**
 * Reusable Media Uploader
 *
 * Props:
 * - api (required)
 * - valueUrl (string)        -> preview URL
 * - valueAssetId (string)    -> stored assetId
 * - type ("image" | "video") -> default "image"
 * - onChange({ previewUrl, assetId })
 * - label (string)
 */

export default function MediaUploader({
  api,
  valueUrl = "",
  valueAssetId = "",
  type = "image",
  visibility = "private", // ✅ default safe
  onChange,
  label = "Upload",
}) {
  const inputGalleryRef = useRef(null);
  const inputCameraRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file) {
    if (!file) return;

    setBusy(true);
    setError("");

    try {
      // Instant local preview (app-like). This is NOT persisted anywhere.
      let localPreviewUrl = "";
      try {
        localPreviewUrl = URL.createObjectURL(file);
      } catch {}

      const res = await uploadMediaAsset({
        api,
        file,
        type,
        visibility,
      });

      onChange?.({
        previewUrl: localPreviewUrl, // UI-only preview (blob:)
        assetId: res?.assetId || "",
      });
    } catch (e) {
      setError(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {/* Preview */}
      {valueUrl ? (
        <div className="flex items-center gap-3">
          {type === "image" ? (
            <img
              src={valueUrl}
              alt="Preview"
              className="w-16 h-16 rounded-full object-cover border border-zinc-700"
            />
          ) : (
            <video
              src={valueUrl}
              className="w-24 h-16 rounded border border-zinc-700"
              controls
            />
          )}

          <div className="text-xs text-zinc-400">
            Uploaded {valueAssetId ? "✓" : ""}
          </div>

          <button
            type="button"
            className="ml-auto text-xs text-red-400 hover:text-red-300"
            onClick={() => onChange?.({ previewUrl: "", assetId: "" })}
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="text-xs text-zinc-500">No file selected.</div>
      )}

      {/* Buttons */}
      <div className="flex gap-2 flex-wrap">
        {/* Take Photo (camera) */}
        {type === "image" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputCameraRef.current?.click()}
            className="px-3 py-2 rounded-lg border border-emerald-500 text-emerald-300 text-sm hover:bg-emerald-500/10 disabled:opacity-50"
          >
            Take Photo
          </button>
        )}

        {/* Choose from gallery */}
        <button
          type="button"
          disabled={busy}
          onClick={() => inputGalleryRef.current?.click()}
          className="px-3 py-2 rounded-lg border border-yellow-500 text-yellow-300 text-sm hover:bg-yellow-500/10 disabled:opacity-50"
        >
          Choose File
        </button>
      </div>

      {busy && <div className="text-xs text-yellow-400">Uploading...</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}

      {/* Hidden Inputs */}
      <input
        ref={inputGalleryRef}
        type="file"
        accept={type === "video" ? "video/*" : "image/*"}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          handleFile(file);
        }}
      />

      <input
        ref={inputCameraRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          handleFile(file);
        }}
      />
    </div>
  );
}
