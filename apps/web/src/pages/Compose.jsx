// apps/web/src/pages/Compose.jsx
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export default function Compose() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("image");
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const maxChars = 500;

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg("");
    try {
      setUploading(true);
      const signRes = await api.post("/api/uploads/sign", {
        folder: "kpocha-feed",
        overwrite: true,
      });
      const {
        cloudName,
        apiKey,
        timestamp,
        signature,
        folder,
        public_id,
        overwrite,
        tags,
      } = signRes.data || {};

      const form = new FormData();
      form.append("file", file);
      form.append("api_key", apiKey);
      form.append("timestamp", timestamp);
      form.append("folder", folder);
      form.append("signature", signature);
      if (public_id) form.append("public_id", public_id);
      if (typeof overwrite !== "undefined")
        form.append("overwrite", String(overwrite));
      if (tags) form.append("tags", tags);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
        { method: "POST", body: form }
      );
      if (!uploadRes.ok) throw new Error("Cloudinary upload failed");
      const uploaded = await uploadRes.json();

      setMediaUrl(uploaded.secure_url || uploaded.url || "");
      setMediaType(file.type.startsWith("video/") ? "video" : "image");
      setMsg("Media uploaded ✔");
    } catch (err) {
      setMsg("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function submit() {
    setMsg("");
    if (!text.trim() && !mediaUrl.trim()) {
      setMsg("Add some text or upload a photo/video.");
      return;
    }
    try {
      setPosting(true);
      await api.post("/api/posts", {
        text: text.trim(),
        media: mediaUrl ? [{ url: mediaUrl.trim(), type: mediaType }] : [],
        isPublic: true,
        tags: [],
      });
      setMsg("Posted!");
      navigate("/browse");
    } catch (e) {
      setMsg(e?.response?.data?.error || "Post failed.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Write a post</h1>
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-zinc-300 hover:text-white"
          >
            Close
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            const v = e.target.value.slice(0, maxChars);
            setText(v);
          }}
          placeholder="Write up to 500 characters…"
          className="w-full h-48 bg-[#0f0f0f] border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-gold mb-2"
        />

        <div className="text-right text-xs text-zinc-400 mb-3">
          {text.length}/{maxChars}
        </div>

        {mediaUrl ? (
          <div className="mb-3">
            <p className="text-[10px] text-zinc-400 mb-1">Media preview:</p>
            {mediaType === "video" ? (
              <video
                src={mediaUrl}
                controls
                className="w-full max-h-64 rounded-lg border border-zinc-800 object-cover"
              />
            ) : (
              <img
                src={mediaUrl}
                alt="uploaded"
                className="w-full max-h-64 rounded-lg border border-zinc-800 object-cover"
              />
            )}
          </div>
        ) : null}

        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-900"
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Upload media"}
          </button>
          <select
            value={mediaType}
            onChange={(e) => setMediaType(e.target.value)}
            className="bg-black border border-zinc-800 rounded-md px-2 py-1.5 text-xs"
          >
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {msg ? <div className="text-xs text-zinc-300 mb-3">{msg}</div> : null}

        <button
          onClick={submit}
          disabled={posting || uploading}
          className="w-full rounded-lg bg-gold text-black py-2 font-semibold disabled:opacity-50"
        >
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}
