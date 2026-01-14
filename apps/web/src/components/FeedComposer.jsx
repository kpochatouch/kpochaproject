// apps/web/src/components/FeedComposer.jsx
import React, { useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

/**
 * FeedComposer - dual-mode composer
 *
 * Props:
 *  - lga (string) optional (keeps previous API)
 *  - onPosted () optional (previous API)
 *  - inline (boolean) -> if true render compact inline composer (default: true)
 *  - exitTo (string) -> path to navigate to on Close (full-page only)
 *  - showHeader (boolean) -> show header for full-page (default true)
 *  - autoGoto (string|null) -> redirect after posting, default "/browse" for full-page, null disables
 *
 * Behaviour:
 *  - Inline: acts as a compact composer at the top of Feed.
 *            Focusing the textarea navigates to /compose (old behaviour kept).
 *            You can still attach media and post directly without going to /compose.
 *  - Full-page: used on /compose; shows full textarea, media preview, progress, etc.
 */
export default function FeedComposer({
  lga = "",
  onPosted = () => {},
  inline = true,
  exitTo = null,
  showHeader = true,
  autoGoto = inline ? null : "/browse",
}) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("image"); // "image" | "video"
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");

  const maxChars = 500;

  const canSubmit = useMemo(
    () => !posting && !uploading && (text.trim().length > 0 || !!mediaUrl),
    [posting, uploading, text, mediaUrl],
  );

  function close() {
    if (exitTo) return navigate(exitTo);
    try {
      navigate(-1);
    } catch {
      navigate("/");
    }
  }

  // old behavior: inline composer navigates to /compose when focusing the textarea
  function maybeNavigateToCompose() {
    if (!inline) return;
    navigate("/compose");
  }

  async function uploadFile(file) {
    if (!file) return;
    setMsg("");
    setUploading(true);
    setProgress(0);

    try {
      const sign = await api.post("/api/uploads/sign", {
        folder: "kpocha-feed",
        overwrite: true,
      });

      const { cloudName, apiKey, timestamp, signature, folder } =
        sign.data || {};
      if (!cloudName || !apiKey || !timestamp || !signature) {
        throw new Error("Upload signing failed");
      }

      const form = new FormData();
      form.append("file", file);
      form.append("timestamp", timestamp);
      form.append("api_key", apiKey);
      form.append("signature", signature);
      form.append("folder", folder);

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          "POST",
          `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
        );

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            try {
              const json = JSON.parse(xhr.responseText);
              const url = json.secure_url || json.url || "";
              if (!url) throw new Error("Upload response missing URL");

              // Detect actual media type from file
              const isVideo = file.type?.startsWith("video/");
              setMediaUrl(url);
              setMediaType(isVideo ? "video" : "image");
              setMsg("Media uploaded ✔");
              resolve(json);
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error("Upload failed"));
          }
        };

        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(form);
      });
    } catch (err) {
      console.error("upload error", err);
      setMsg("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      setProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function submit() {
    setMsg("");

    if (!canSubmit) {
      if (!text.trim() && !mediaUrl) {
        setMsg("Add text or upload a photo/video.");
      }
      return;
    }

    const cleanText = text.trim();
    const cleanLga = (lga || "").trim().toUpperCase();

    try {
      setPosting(true);

      await api.post("/api/posts", {
        text: cleanText,
        media: mediaUrl ? [{ url: mediaUrl.trim(), type: mediaType }] : [],
        lga: cleanLga,
        isPublic: true,
        tags: [], // reserved for future: hashtag extraction, etc.
      });

      setMsg("Posted!");
      setText("");
      setMediaUrl("");
      setMediaType("image");

      try {
        onPosted && onPosted();
      } catch (err) {
        console.warn("onPosted callback error", err);
      }

      if (autoGoto) {
        navigate(autoGoto);
      }
    } catch (e) {
      console.error("post error", e);
      const errMsg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        "Post failed.";
      setMsg(errMsg);
    } finally {
      setPosting(false);
    }
  }

  // ----- RENDER: two modes -----

  if (inline) {
    // compact inline composer (keeps old markup + behavior)
    return (
      <div className="mb-4 p-3 rounded-xl border border-zinc-800 bg-black/30 w-full max-w-2xl mx-auto">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="font-semibold text-white text-sm">Share an update</h3>
          {msg ? (
            <span className="text-[10px] text-zinc-400">{msg}</span>
          ) : null}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, maxChars))}
          onFocus={maybeNavigateToCompose}
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
              onChange={(e) => uploadFile(e.target.files?.[0])}
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
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-lg bg-gold text-black px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // full-page composer
  return (
    <div className="bg-[#0b0c10] text-white p-4 rounded-lg border border-zinc-800">
      {showHeader && (
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={close}
            className="px-3 py-1 rounded border border-zinc-600 hover:bg-zinc-900 text-xs"
          >
            Close
          </button>
          <h2 className="text-lg font-semibold">Create Post</h2>
          <div />
        </div>
      )}

      <textarea
        className="w-full h-32 bg-[#0f0f0f] border border-zinc-700 rounded-lg px-3 py-2 text-sm mb-2"
        placeholder="Write something..."
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, maxChars))}
      />

      <div className="text-right text-xs text-zinc-400 mb-2">
        {text.length}/{maxChars}
      </div>

      {mediaUrl && (
        <div className="mb-3">
          {mediaType === "video" ? (
            <video
              src={mediaUrl}
              controls
              className="w-full h-40 object-cover rounded"
            />
          ) : (
            <img
              src={mediaUrl}
              alt="preview"
              className="w-full h-40 object-cover rounded"
            />
          )}
        </div>
      )}

      {uploading && (
        <div className="mt-2">
          <div className="text-xs">Uploading: {progress}%</div>
          <div className="w-full bg-zinc-800 rounded h-2 mt-1">
            <div
              className="bg-gold h-2 rounded"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          className="border border-zinc-600 rounded px-3 py-1.5 text-xs hover:bg-zinc-900"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "Upload media"}
        </button>

        <select
          className="bg-black border border-zinc-700 rounded px-2 py-1.5 text-xs"
          value={mediaType}
          onChange={(e) => setMediaType(e.target.value)}
        >
          <option value="image">Image</option>
          <option value="video">Video</option>
        </select>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => uploadFile(e.target.files?.[0])}
        />

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="ml-auto bg-gold text-black px-4 py-1.5 rounded text-sm font-semibold disabled:opacity-50"
        >
          {posting ? "Posting…" : "Post"}
        </button>
      </div>

      {msg && <div className="text-xs text-zinc-300 mt-2">{msg}</div>}
    </div>
  );
}
