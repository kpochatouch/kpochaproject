//apps/web/src/components/FaceEnrollModal.jsx
import React from "react";
import MediaUploader from "./MediaUploader.jsx";

export default function FaceEnrollModal({
  open,
  api,
  busy = false,
  title = "Face Verification — Take Selfie",
  subtitle = "This selfie is used only for face verification (not a public profile photo).",
  selfie,
  onChangeSelfie,
  onContinue,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div className="mb-4 border border-yellow-500/50 rounded-lg p-3 bg-black">
      <div className="text-sm font-semibold text-yellow-300 mb-2">{title}</div>
      <p className="text-xs text-zinc-400 mb-3">{subtitle}</p>

      <MediaUploader
        api={api}
        type="image"
        visibility="private" // ✅ never public
        valueUrl={selfie?.previewUrl || ""}
        valueAssetId={selfie?.assetId || ""}
        onChange={({ previewUrl, assetId }) =>
          onChangeSelfie({ previewUrl, assetId })
        }
      />

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          disabled={!selfie?.assetId || busy}
          className="px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold text-sm disabled:opacity-60"
          onClick={onContinue}
        >
          Continue
        </button>

        <button
          type="button"
          disabled={busy}
          className="px-4 py-2 rounded-lg border border-yellow-500/50 text-yellow-300 text-sm hover:bg-yellow-500/10"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
