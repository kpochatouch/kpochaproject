// apps/web/src/components/SmartUpload.jsx
import { useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

// Optional unsigned preset fallback
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "";

/**
 * SmartUpload: iOS-friendly uploader with 3 choices:
 *  - Upload from files (Photos / Files picker; supports images & PDFs)
 *  - Take a selfie (front camera)
 *  - Take photo/video (rear camera)
 *
 * Props:
 *  - title?: string (button label)
 *  - folder?: string (Cloudinary folder; default "kpocha")
 *  - onUploaded: (url: string) => void
 *  - accept?: string (override accepted MIME list)
 *  - disabled?: boolean
 */
export default function SmartUpload({
  title = "Upload",
  folder = "kpocha",
  onUploaded,
  accept,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // 3 hidden inputs for 3 flows (avoid toggling capture dynamically)
  const inputFilesRef = useRef(null);
  const inputSelfieRef = useRef(null);
  const inputRearRef = useRef(null);

  // Defaults: allow images + PDFs for “files” path
  const acceptFiles = useMemo(
    () => accept || "image/*,application/pdf",
    [accept]
  );

  async function getSignedParams(targetFolder) {
    try {
      // If your /api/uploads/sign route exists, use it.
      const { data } = await api.post("/api/uploads/sign", { folder: targetFolder });
      if (data?.signature && data?.apiKey && data?.timestamp) {
        return {
          type: "signed",
          cloudName: data.cloudName,
          apiKey: data.apiKey,
          signature: data.signature,
          timestamp: data.timestamp,
          folder: data.folder || targetFolder,
        };
      }
    } catch {
      // fall back below
    }
    // Fallback to unsigned preset (must be configured in Cloudinary)
    if (!CLOUD_NAME || !UPLOAD_PRESET) {
      throw new Error("Uploads unavailable (no signature or unsigned preset).");
    }
    return { type: "unsigned", cloudName: CLOUD_NAME, uploadPreset: UPLOAD_PRESET, folder: targetFolder };
  }

  async function uploadToCloudinary(file) {
    const meta = await getSignedParams(folder);
    const form = new FormData();

    if (meta.type === "signed") {
      form.append("file", file);
      form.append("api_key", meta.apiKey);
      form.append("timestamp", meta.timestamp);
      form.append("signature", meta.signature);
      form.append("folder", meta.folder);
      const url = `https://api.cloudinary.com/v1_1/${meta.cloudName}/auto/upload`;
      const res = await fetch(url, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json?.secure_url) throw new Error(json?.error?.message || "Upload failed");
      return json.secure_url;
    } else {
      form.append("file", file);
      form.append("upload_preset", meta.uploadPreset);
      form.append("folder", meta.folder);
      const url = `https://api.cloudinary.com/v1_1/${meta.cloudName}/auto/upload`;
      const res = await fetch(url, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json?.secure_url) throw new Error(json?.error?.message || "Upload failed");
      return json.secure_url;
    }
  }

  async function handlePicked(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    setMsg("");
    setBusy(true);
    try {
      const url = await uploadToCloudinary(file);
      onUploaded?.(url);
      setMsg("Uploaded ✓");
    } catch (err) {
      setMsg(err?.message || "Upload failed");
    } finally {
      setBusy(false);
      // reset input value so picking the same file again re-fires change
      e.target.value = "";
      setOpen(false);
      // Clear success msg after a short while
      setTimeout(() => setMsg(""), 1800);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900 disabled:opacity-50"
        title="Upload"
      >
        {busy ? "Uploading…" : title}
      </button>

      {msg ? <div className="text-xs text-zinc-400 mt-1">{msg}</div> : null}

      {/* Small dropdown menu */}
      {open && !disabled && (
        <div className="absolute z-10 mt-1 w-56 rounded-md border border-zinc-800 bg-black shadow-lg">
          <MenuItem
            onClick={() => {
              setOpen(false);
              inputFilesRef.current?.click();
            }}
            text="Upload from files (Photos / Files, supports PDF)"
            sub="Recommended on iOS"
          />
          <Divider />
          <MenuItem
            onClick={() => {
              setOpen(false);
              inputSelfieRef.current?.click();
            }}
            text="Take a selfie (front camera)"
          />
          <MenuItem
            onClick={() => {
              setOpen(false);
              inputRearRef.current?.click();
            }}
            text="Take photo/video (rear camera)"
          />
        </div>
      )}

      {/* Hidden inputs */}
      {/* 1) Files picker — no capture (shows Photos/Files picker on iOS) */}
      <input
        ref={inputFilesRef}
        type="file"
        accept={acceptFiles}
        className="hidden"
        onChange={handlePicked}
      />
      {/* 2) Front camera still image capture */}
      <input
        ref={inputSelfieRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={handlePicked}
      />
      {/* 3) Rear camera: allow image or video */}
      <input
        ref={inputRearRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        className="hidden"
        onChange={handlePicked}
      />
    </div>
  );
}

function MenuItem({ text, sub, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2 hover:bg-zinc-900"
    >
      <div className="text-sm">{text}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </button>
  );
}
function Divider() {
  return <div className="h-px bg-zinc-800" />;
}
