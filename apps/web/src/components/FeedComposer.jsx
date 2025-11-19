// apps/web/src/components/FeedComposer.jsx
import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export default function FeedComposer({ lga, onPosted }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("image");
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

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
      if (!cloudName || !apiKey || !timestamp || !signature) {
        throw new Error("Upload signing failed");
      }

      const form = new FormData();
      form.append("file", file);
      form.append("api_key", apiKey);
      form.append("timestamp", timestamp);
      form.append("folder", folder);
      form.append("signature", signature);
      if (public_id) form.append("public_id", public_id);
      if (typeof overwrite !== "undefined") form.append("overwrite", String(overwrite));
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
      console.error("upload error:", err);
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
        lga: (lga || "").toUpperCase(),
        isPublic: true,
        tags: [],
      });
      setText("");
      setMediaUrl("");
      setMsg("Posted!");
      onPosted?.();
    } catch (e) {
      setMsg(e?.response?.data?.error || "Post failed.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mb-4 p-3 rounded-xl border border-zinc-800 bg-black/30 w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold text-white text-sm">Share an update</h3>
        {msg ? <span className="text-[10px] text-zinc-400">{msg}</span> : null}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => navigate("/compose")}
        placeholder="Tap to write a longer post…"
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 mb-2 outline-none focus:border-gold text-sm min-h-[50px]"
      />

      {mediaUrl ? (
        <div className="mb-2">
          <p className="text-[10px] text-zinc-400 mb-1">Preview:</p>
          {mediaType === "video" ? (
            <video
              src={mediaUrl}
              controls
              className="w-full max-h-52 rounded-lg border border-zinc-800 object-cover max-w-full"
            />
          ) : (
            <img
              src={mediaUrl}
              alt="uploaded"
              loading="lazy"
              className="w-full max-h-52 rounded-lg border border-zinc-800 object-cover max-w-full"
            />
          )}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-900"
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Upload"}
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate("/compose")}
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-white hover:bg-zinc-900"
          >
            Write long post
          </button>
          <button
            onClick={submit}
            disabled={posting || uploading}
            className="rounded-lg bg-gold text-black px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
