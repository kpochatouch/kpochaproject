// apps/web/src/components/SmartUpload.jsx
import { useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

// Optional unsigned preset fallback (only used if /api/uploads/sign is unavailable)
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET =
  import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET ||
  import.meta.env.VITE_CLOUDINARY_UNSIGNED_PRESET ||
  "";

/**
 * SmartUpload: iOS-friendly uploader with 3 choices:
 *  - Upload from files (Photos / Files picker; supports images & PDFs based on `accept`)
 *  - Take a selfie (front camera)
 *  - Take photo/video (rear camera)
 *
 * Props:
 *  - title?: string (button label)
 *  - folder?: string (Cloudinary folder; default "kpocha")
 *  - onUploaded?: (url: string) => void
 *  - onUploadedMany?: (urls: string[]) => void
 *  - accept?: string (override accepted MIME list; defaults to "image/*,application/pdf")
 *  - multiple?: boolean (default false; used in the Files picker only)
 *  - disabled?: boolean
 *
 * Usage example:
 *  <SmartUpload
 *     title="Upload"
 *     folder="kpocha/pro-apps"
 *     accept="image/*,application/pdf"
 *     onUploaded={(url) => setIdentity({ ...identity, idUrl: url })}
 *  />
 */
export default function SmartUpload({
  title = "Upload",
  folder = "kpocha",
  onUploaded,
  onUploadedMany,
  accept,
  multiple = false,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // 3 hidden inputs for 3 flows (avoid toggling capture dynamically)
  const inputFilesRef = useRef(null);
  const inputSelfieRef = useRef(null);
  const inputRearRef = useRef(null);

  // Defaults: allow images + PDFs for “files” path unless caller overrides
  const acceptFiles = useMemo(
    () => accept || "image/*,application/pdf",
    [accept]
  );

  async function getSignedParams(targetFolder) {
    try {
      // Prefer your server signature route (safer than unsigned presets)
      const { data } = await api.post("/api/uploads/sign", { folder: targetFolder });
      if (data?.signature && data?.apiKey && data?.timestamp && data?.cloudName) {
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
      // falls through to unsigned
    }
    // Fallback to unsigned preset (must exist in Cloudinary)
    if (!CLOUD_NAME || !UPLOAD_PRESET) {
      throw new Error("Uploads unavailable (no signature and no unsigned preset configured).");
    }
    return { type: "unsigned", cloudName: CLOUD_NAME, uploadPreset: UPLOAD_PRESET, folder: targetFolder };
  }

  async function uploadOne(file) {
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
    const list = Array.from(e?.target?.files || []);
    // reset input so picking the same file again re-fires change
    e.target.value = "";

    if (!list.length) return;
    setMsg("");
    setErr("");
    setBusy(true);

    try {
      const urls = [];
      for (const f of list) {
        // Defensive: small size hint (optional)
        // if (f.size > 50 * 1024 * 1024) throw new Error("File too large (50MB max).");
        const u = await uploadOne(f);
        urls.push(u);
      }
      if (urls.length > 1) {
        onUploadedMany?.(urls);
      }
      if (urls.length >= 1) {
        onUploaded?.(urls[0]);
      }
      setMsg(urls.length > 1 ? `Uploaded ${urls.length} files ✓` : "Uploaded ✓");
      // Clear success message shortly
      setTimeout(() => setMsg(""), 1800);
    } catch (error) {
      setErr(error?.message || "Upload failed");
    } finally {
      setBusy(false);
      setOpen(false);
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

      {msg ? <div className="text-xs text-emerald-400 mt-1">{msg}</div> : null}
      {err ? <div className="text-xs text-red-400 mt-1">{err}</div> : null}

      {/* Small dropdown menu */}
      {open && !disabled && (
        <div className="absolute z-10 mt-1 w-64 rounded-md border border-zinc-800 bg-black shadow-lg">
          <MenuItem
            onClick={() => {
              setOpen(false);
              inputFilesRef.current?.click();
            }}
            text={`Upload from files${multiple ? " (multi-select)" : ""}`}
            sub="Photos / Files (iOS-friendly)"
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
      {/* 1) Files picker — no capture (shows Photos/Files picker on iOS). Respects accept & multiple */}
      <input
        ref={inputFilesRef}
        type="file"
        accept={acceptFiles}
        multiple={multiple}
        className="hidden"
        onChange={handlePicked}
      />
      {/* 2) Front camera still image capture (forces camera UI on mobile) */}
      <input
        ref={inputSelfieRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={handlePicked}
      />
      {/* 3) Rear camera: allow image or video (forces camera UI on mobile) */}
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
