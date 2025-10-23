import { useRef, useState } from "react";

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "";

export default function NativeUpload({
  title = "Upload",
  onUploaded,
  capture,              // "environment" | "user" | undefined
  allowPdf = false,     // set true only where PDFs make sense
  folder = "kpocha/pro-apps",
  className = "px-3 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900",
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const accept = allowPdf ? "image/*,.pdf" : "image/*";

  function openPicker() {
    inputRef.current?.click();
  }

  async function onChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!CLOUD_NAME || !UPLOAD_PRESET) {
      alert("Upload env not set. Please configure Cloudinary env.");
      return;
    }

    setBusy(true);
    setProgress(0);

    try {
      const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`;
      const fd = new FormData();
      fd.append("upload_preset", UPLOAD_PRESET);
      fd.append("file", file);
      fd.append("folder", folder);

      // Use XHR to get progress (fetch doesn’t expose upload progress)
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          setProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      };
      xhr.onload = () => {
        setBusy(false);
        setProgress(100);
        try {
          const res = JSON.parse(xhr.responseText);
          if (res?.secure_url) onUploaded?.(res.secure_url);
          else alert("Upload failed");
        } catch {
          alert("Upload failed");
        }
      };
      xhr.onerror = () => {
        setBusy(false);
        alert("Network error while uploading");
      };
      xhr.send(fd);
    } catch {
      setBusy(false);
      alert("Upload failed");
    } finally {
      // reset so picking the same file again still triggers onChange
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture={capture}
        onChange={onChange}
        className="hidden"
      />
      <button type="button" onClick={openPicker} disabled={busy} className={className}>
        {busy ? `Uploading… ${progress}%` : title}
      </button>
    </>
  );
}
