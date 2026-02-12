// apps/web/src/components/FeedComposer.jsx
import React, { useRef, useState, useMemo } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
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

  // ---------- Video trimming (2 mins max) ----------
  const [pickedFile, setPickedFile] = useState(null); // File before upload (mainly video)
  const [pickedDuration, setPickedDuration] = useState(0); // seconds (video only)
  const [trimStart, setTrimStart] = useState(0); // seconds
  const [trimEnd, setTrimEnd] = useState(120); // seconds
  const [trimming, setTrimming] = useState(false);

  const ffmpegRef = useRef(null);
  const ffmpegLoadingRef = useRef(false);

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

  async function getVideoDurationSeconds(file) {
    try {
      const url = URL.createObjectURL(file);
      const dur = await new Promise((resolve) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => resolve(Number(v.duration || 0));
        v.onerror = () => resolve(0);
        v.src = url;
      });
      URL.revokeObjectURL(url);
      return dur || 0;
    } catch {
      return 0;
    }
  }

  async function ensureFFmpegLoaded() {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (ffmpegLoadingRef.current) {
      // wait until the current load finishes
      while (ffmpegLoadingRef.current) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100));
      }
      return ffmpegRef.current;
    }

    ffmpegLoadingRef.current = true;
    try {
      const ffmpeg = new FFmpeg();

      // Load FFmpeg core from CDN (works with Vite via toBlobURL)
      const base = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(
          `${base}/ffmpeg-core.wasm`,
          "application/wasm",
        ),
      });

      ffmpegRef.current = ffmpeg;
      return ffmpeg;
    } finally {
      ffmpegLoadingRef.current = false;
    }
  }

  function clamp(n, min, max) {
    const x = Number(n);
    if (!isFinite(x)) return min;
    return Math.max(min, Math.min(max, x));
  }

  async function trimVideoFile(file, startSec, endSec) {
    const ffmpeg = await ensureFFmpegLoaded();

    const s = clamp(startSec, 0, 120);
    const e = clamp(endSec, 0, 120);
    if (!(e > s)) throw new Error("Invalid trim range");

    // name inputs/outputs
    const inName = "in.mp4";
    const outName = "out.mp4";

    await ffmpeg.writeFile(inName, await fetchFile(file));

    // Try fast stream copy first
    try {
      await ffmpeg.exec([
        "-ss",
        String(s),
        "-i",
        inName,
        "-t",
        String(e - s),
        "-c",
        "copy",
        outName,
      ]);
    } catch (err) {
      // Fallback: re-encode (slower but more compatible)
      await ffmpeg.exec([
        "-ss",
        String(s),
        "-i",
        inName,
        "-t",
        String(e - s),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        outName,
      ]);
    }

    const data = await ffmpeg.readFile(outName);
    return new File([data.buffer], "trimmed.mp4", { type: "video/mp4" });
  }

  // old behavior: inline composer navigates to /compose when focusing the textarea
  function maybeNavigateToCompose() {
    if (!inline) return;
    navigate("/compose");
  }

  async function handlePickFile(file) {
    if (!file) return;

    setMsg("");
    const isVideo = file.type?.startsWith("video/");

    if (!isVideo) {
      // images: same behavior as before (upload immediately)
      setPickedFile(null);
      setPickedDuration(0);
      setTrimStart(0);
      setTrimEnd(120);
      return uploadFile(file);
    }

    // video: do NOT upload yet — prepare trim UI
    setPickedFile(file);
    setTrimming(false);

    const dur = await getVideoDurationSeconds(file);
    setPickedDuration(dur || 0);

    setTrimStart(0);
    setTrimEnd(120);

    setMsg(
      dur > 120
        ? "Video is longer than 2 mins — trim it before upload."
        : "Video selected — you can trim (optional) then upload.",
    );
  }

  async function uploadFile(file) {
    if (!file) return;

    // Enforce 2-min max for videos (avoid frustrating “upload then reject”)
    const isVideo = file.type?.startsWith("video/");
    if (isVideo) {
      const dur = await getVideoDurationSeconds(file);
      if (dur && dur > 120) {
        setMsg("Video must be 2 minutes max. Please trim before uploading.");
        return;
      }
    }

    setMsg("");
    setUploading(true);
    setProgress(0);

    try {
      const sign = await api.post("/api/uploads/sign", {
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
      } = sign.data || {};

      const form = new FormData();
      form.append("file", file);
      form.append("timestamp", timestamp);
      form.append("api_key", apiKey);
      form.append("signature", signature);
      form.append("folder", folder);

      if (public_id) form.append("public_id", public_id);
      if (typeof overwrite !== "undefined")
        form.append("overwrite", String(overwrite));
      if (tags) form.append("tags", tags);

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

        {pickedFile ? (
          <div className="mb-2 p-2 rounded-lg border border-zinc-800 bg-black/30">
            <div className="text-[10px] text-zinc-400 mb-2">
              Video duration:{" "}
              {pickedDuration ? `${pickedDuration.toFixed(1)}s` : "?"} — Trim
              range (0–120s)
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="120"
                value={trimStart}
                onChange={(e) => setTrimStart(e.target.value)}
                className="w-20 bg-black border border-zinc-800 rounded px-2 py-1 text-xs"
                placeholder="start"
              />
              <input
                type="number"
                min="0"
                max="120"
                value={trimEnd}
                onChange={(e) => setTrimEnd(e.target.value)}
                className="w-20 bg-black border border-zinc-800 rounded px-2 py-1 text-xs"
                placeholder="end"
              />

              <button
                type="button"
                className="ml-auto rounded-md border border-zinc-700 px-2 py-1 text-[10px] hover:bg-zinc-900"
                onClick={() => {
                  setPickedFile(null);
                  setPickedDuration(0);
                  setTrimStart(0);
                  setTrimEnd(120);
                  setMsg("Video cleared");
                }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}

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

            <button
              type="button"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-900"
              disabled={!pickedFile || uploading || trimming}
              onClick={async () => {
                try {
                  if (!pickedFile) return;
                  setTrimming(true);
                  setMsg("Trimming… (first time may take a bit to load)");
                  const trimmed = await trimVideoFile(
                    pickedFile,
                    trimStart,
                    trimEnd,
                  );
                  setPickedFile(trimmed);
                  setPickedDuration(Math.min(120, trimEnd - trimStart));
                  setMsg("Trim applied ✔ Now upload.");
                } catch (e) {
                  console.error(e);
                  setMsg("Trim failed.");
                } finally {
                  setTrimming(false);
                }
              }}
            >
              {trimming ? "Trimming…" : "Trim"}
            </button>

            <button
              type="button"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-900"
              disabled={!pickedFile || uploading || trimming}
              onClick={() => uploadFile(pickedFile)}
            >
              Upload video
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
              onChange={(e) => handlePickFile(e.target.files?.[0])}
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
          onChange={(e) => handlePickFile(e.target.files?.[0])}
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
