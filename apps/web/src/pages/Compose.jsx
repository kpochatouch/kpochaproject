//apps/web/src/pages/Compose.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import ImageCropperModal from "../components/ImageCropper.jsx";
import { useToast } from "../components/Toast.jsx";
import { uploadMediaAsset, waitForMediaAssetReady } from "../lib/r2Upload";

const MAX_WORDS = 500;

// File size limits (adjust easily)
const MAX_IMAGE_MB = 10;
const MAX_VIDEO_MB = 80;

// Video rule
const MAX_VIDEO_SECONDS = 120;

function wordsCount(s) {
  const w = String(s || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return w.length;
}

function trimToWords(s, maxWords) {
  const arr = String(s || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return arr.slice(0, maxWords).join(" ");
}

function detectIsVideo(file) {
  const type = (file?.type || "").toLowerCase();
  const name = (file?.name || "").toLowerCase();
  return (
    type.startsWith("video/") || /\.(mp4|mov|webm|mkv|3gp|avi)$/i.test(name)
  );
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

function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

async function makeVideoThumbnail(file) {
  return new Promise((resolve) => {
    let url = "";
    try {
      url = URL.createObjectURL(file);

      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.src = url;

      const cleanup = (result = "") => {
        try {
          if (url) URL.revokeObjectURL(url);
        } catch {}
        resolve(result);
      };

      // If the device cannot decode the codec, this will fire.
      v.onerror = () => cleanup("");

      v.onloadedmetadata = () => {
        try {
          // Seek a tiny bit forward; Android WebView often needs this before a frame exists.
          const t = Math.min(0.1, Math.max(0, (v.duration || 0) * 0.05));
          v.currentTime = isFinite(t) ? t : 0;
        } catch {
          cleanup("");
        }
      };

      v.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = v.videoWidth || 720;
          canvas.height = v.videoHeight || 1280;

          const ctx = canvas.getContext("2d");
          if (!ctx) return cleanup("");

          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);

          canvas.toBlob(
            (blob) => {
              if (!blob) return cleanup("");
              cleanup(URL.createObjectURL(blob));
            },
            "image/jpeg",
            0.85,
          );
        } catch {
          cleanup("");
        }
      };

      // Kick it
      v.load();
    } catch {
      try {
        if (url) URL.revokeObjectURL(url);
      } catch {}
      resolve("");
    }
  });
}

function pct(part, whole) {
  const w = Number(whole) || 0;
  if (!w || !isFinite(w) || w <= 0) return 0;
  const p = (Number(part) / w) * 100;
  return Math.max(0, Math.min(100, p));
}

export default function Compose() {
  const navigate = useNavigate();
  const toast = useToast();

  // text
  const [text, setText] = useState("");
  const textareaRef = useRef(null);

  // media (pre-upload)
  const [mediaFile, setMediaFile] = useState(null); // File
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState(""); // object URL for preview
  const [mediaType, setMediaType] = useState("image"); // "image" | "video"

  // video trim state
  const [videoDuration, setVideoDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(MAX_VIDEO_SECONDS);
  const [mustTrim, setMustTrim] = useState(false); // >2mins -> forced
  const [trimming, setTrimming] = useState(false);

  // crop state
  const [cropOpen, setCropOpen] = useState(false);

  // upload/post
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);

  // video preview poster (thumbnail)
  const [videoThumbUrl, setVideoThumbUrl] = useState("");

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [videoPreviewError, setVideoPreviewError] = useState("");

  // FFmpeg lazy refs
  const ffmpegRef = useRef(null);
  const ffmpegLoadingRef = useRef(false);
  const [trimUnavailable, setTrimUnavailable] = useState(false);

  const wordCount = useMemo(() => wordsCount(text), [text]);
  const canPost = useMemo(() => {
    const hasText = text.trim().length > 0;
    const hasMedia = !!mediaFile;
    // If mustTrim is true, user must apply a trim that yields <=120s
    if (mustTrim && mediaType === "video") return false;
    return !uploading && !posting && (hasText || hasMedia);
  }, [text, mediaFile, uploading, posting, mustTrim, mediaType]);

  // Auto-expand textarea (smooth, durable)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  // Cleanup object URLs
  useEffect(() => {
    return () => {
      try {
        if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
      } catch {}
      try {
        if (videoThumbUrl) URL.revokeObjectURL(videoThumbUrl);
      } catch {}
    };
  }, [mediaPreviewUrl, videoThumbUrl]);

  function close() {
    navigate(-1);
  }

  async function ensureFFmpegLoaded() {
    if (ffmpegRef.current) return ffmpegRef.current;

    if (ffmpegLoadingRef.current) {
      while (ffmpegLoadingRef.current) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100));
      }
      return ffmpegRef.current;
    }

    ffmpegLoadingRef.current = true;
    try {
      const [{ FFmpeg }, { fetchFile }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);

      const ffmpeg = new FFmpeg();

      try {
        await ffmpeg.load({
          coreURL: "/ffmpeg/ffmpeg-core.js",
          wasmURL: "/ffmpeg/ffmpeg-core.wasm",
          workerURL: "/ffmpeg/ffmpeg-core.worker.js",
        });
      } catch (err) {
        console.error("[compose][ffmpeg] load failed", err);
        setTrimUnavailable(true);
        throw new Error("FFMPEG_LOAD_FAILED");
      }

      ffmpeg.__fetchFile = fetchFile;
      ffmpegRef.current = ffmpeg;
      setTrimUnavailable(false);
      return ffmpeg;
    } finally {
      ffmpegLoadingRef.current = false;
    }
  }

  function clearMedia() {
    setMediaFile(null);
    setMediaType("image");
    setVideoDuration(0);
    setTrimStart(0);
    setTrimEnd(MAX_VIDEO_SECONDS);
    setMustTrim(false);

    try {
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    } catch {}
    setMediaPreviewUrl("");

    try {
      if (videoThumbUrl) URL.revokeObjectURL(videoThumbUrl);
    } catch {}
    setVideoThumbUrl("");

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onPickFile(file) {
    if (!file) return;

    // messages go to toast now

    // size check
    const isVideo = detectIsVideo(file);
    const sizeMB = file.size / (1024 * 1024);

    if (!isVideo && sizeMB > MAX_IMAGE_MB) {
      toast.error(`Image too large. Max ${MAX_IMAGE_MB}MB.`);
      return;
    }

    if (isVideo && sizeMB > MAX_VIDEO_MB) {
      toast.error(`Video too large. Max ${MAX_VIDEO_MB}MB.`);
      return;
    }

    // set preview
    const url = URL.createObjectURL(file);
    try {
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    } catch {}
    setMediaPreviewUrl(url);

    setMediaFile(file);
    setMediaType(isVideo ? "video" : "image");

    setVideoPreviewError("");

    // reset edit states
    setTrimStart(0);
    setTrimEnd(MAX_VIDEO_SECONDS);
    setMustTrim(false);
    setVideoDuration(0);

    if (!isVideo) {
      // clear any old video thumb
      try {
        if (videoThumbUrl) URL.revokeObjectURL(videoThumbUrl);
      } catch {}
      setVideoThumbUrl("");

      toast.success("Image selected. You can crop before posting.");
      return;
    }

    // make a preview poster thumbnail (best-effort)
    const thumb = await makeVideoThumbnail(file);

    // revoke previous thumb url
    try {
      if (videoThumbUrl) URL.revokeObjectURL(videoThumbUrl);
    } catch {}

    // set new thumb url
    setVideoThumbUrl(thumb || "");

    const dur = await getVideoDurationSeconds(file);
    setVideoDuration(dur || 0);
    if (!dur || !isFinite(dur) || dur <= 0) {
      toast.info("Video loaded. Duration not detected yet — trim still works.");
    }

    if (dur && dur > MAX_VIDEO_SECONDS) {
      setMustTrim(true);
      setTrimStart(0);
      setTrimEnd(MAX_VIDEO_SECONDS); // default 0–120
      toast.error("Video is longer than 2 minutes. Trim is required.");
    } else {
      setMustTrim(false);
      setTrimStart(0);
      setTrimEnd(dur ? Math.floor(dur) : MAX_VIDEO_SECONDS);
      toast.info("Video selected. You can trim if you want.");
    }
  }

  async function applyVideoTrim() {
    if (!mediaFile || mediaType !== "video") return;

    const s = Math.max(0, Number(trimStart) || 0);
    const e = Math.max(0, Number(trimEnd) || 0);

    if (!(e > s)) {
      toast.error("Invalid trim range.");
      return;
    }
    if (e - s > MAX_VIDEO_SECONDS) {
      toast.error("Trim result must be 2:00 max.");
      return;
    }

    setTrimming(true);
    toast.info("Trimming…");

    try {
      const ffmpeg = await ensureFFmpegLoaded();
      const fetchFile = ffmpeg.__fetchFile;

      // ✅ unique names (prevents collisions across multiple trims)
      const uid = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const inName = `in_${uid}.mp4`;
      const outName = `out_${uid}.mp4`;

      // ✅ best-effort cleanup if something exists
      try {
        await ffmpeg.deleteFile(inName);
      } catch {}
      try {
        await ffmpeg.deleteFile(outName);
      } catch {}

      // write input
      await ffmpeg.writeFile(inName, await fetchFile(mediaFile));

      const duration = Math.max(0, Number(videoDuration) || 0);
      const safeEnd = duration ? Math.min(e, Math.floor(duration)) : e;
      const safeStart = Math.min(s, Math.max(0, safeEnd - 1));
      const len = Math.max(1, safeEnd - safeStart);

      // ✅ SAFE trim command for WebView:
      // -ss BEFORE -i for fast seek
      // -t for length
      // re-encode to H.264/AAC
      // yuv420p + faststart
      // +genpts fixes timestamp weirdness
      // -avoid_negative_ts make_zero prevents negative ts issues
      await ffmpeg.exec([
        "-hide_banner",
        "-y",
        "-ss",
        String(safeStart),
        "-t",
        String(len),
        "-i",
        inName,
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0?",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-fflags",
        "+genpts",
        "-avoid_negative_ts",
        "make_zero",
        outName,
      ]);

      const data = await ffmpeg.readFile(outName);
      const trimmedFile = new File([data.buffer], "trimmed.mp4", {
        type: "video/mp4",
      });

      // ✅ cleanup FFmpeg FS to save memory
      try {
        await ffmpeg.deleteFile(inName);
      } catch {}
      try {
        await ffmpeg.deleteFile(outName);
      } catch {}

      // update state + preview
      const url = URL.createObjectURL(trimmedFile);
      try {
        if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
      } catch {}
      setMediaPreviewUrl(url);

      // thumbnail is now stale (optional): regenerate later if you want
      setMediaFile(trimmedFile);
      setVideoDuration(Math.min(MAX_VIDEO_SECONDS, len));
      setTrimStart(0);
      setTrimEnd(Math.min(MAX_VIDEO_SECONDS, len));
      setMustTrim(false);

      toast.success("Trim applied.");
    } catch (err) {
      const msg = String(err?.message || err || "");
      console.error("[compose][trim] failed", err);

      if (msg.includes("FFMPEG_LOAD_FAILED")) {
        toast.error("Video trimming is unavailable on this device right now.");
      } else {
        toast.error("Unable to trim this video right now.");
      }
    } finally {
      setTrimming(false);
    }
  }

  async function submit() {
    // messages go to toast now

    if (wordCount > MAX_WORDS) {
      toast.error(`Max ${MAX_WORDS} words.`);
      return;
    }

    if (mustTrim && mediaType === "video") {
      toast.error("Please trim the video to 2 minutes before posting.");
      return;
    }

    if (!text.trim() && !mediaFile) {
      toast.error("Add text or attach media.");
      return;
    }

    try {
      setPosting(true);

      let mediaAssetId = "";
      let thumbAssetId = "";

      if (mediaFile) {
        setUploading(true);
        toast.info("Uploading media…");

        const main = await uploadMediaAsset({
          api,
          file: mediaFile,
          type: mediaType,
          visibility: "public",
        });
        mediaAssetId = main.assetId;

        if (mediaType === "video") {
          toast.info("Processing video…");
          await waitForMediaAssetReady({
            api,
            assetId: mediaAssetId,
          });
        }

        if (mediaType === "video" && videoThumbUrl) {
          try {
            const blob = await fetch(videoThumbUrl).then((r) => r.blob());
            const thumbFile = new File([blob], "thumb.jpg", {
              type: blob.type || "image/jpeg",
            });
            const t = await uploadMediaAsset({
              api,
              file: thumbFile,
              type: "image",
              visibility: "public",
            });
            thumbAssetId = t.assetId;
          } catch {}
        }

        setUploading(false);
      }

      toast.info("Posting…");

      await api.post("/api/posts", {
        text: text.trim(),
        media: mediaAssetId
          ? [
              {
                assetId: mediaAssetId,
                type: mediaType,
                ...(thumbAssetId ? { thumbnailAssetId: thumbAssetId } : {}),
              },
            ]
          : [],
        isPublic: true,
        tags: [],
      });

      toast.success("Posted!");
      navigate("/browse");
    } catch (e) {
      setUploading(false);
      toast.error(e?.response?.data?.error || e?.message || "Post failed.");
    } finally {
      setPosting(false);
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Create Post</h1>
          <button
            onClick={close}
            className="text-sm text-zinc-300 hover:text-white"
          >
            Close
          </button>
        </div>

        {/* autosize textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            const raw = e.target.value;

            // enforce 500 words (not characters)
            const wc = wordsCount(raw);
            if (wc <= MAX_WORDS) {
              setText(raw);
              return;
            }
            setText(trimToWords(raw, MAX_WORDS));
          }}
          placeholder="Write your post…"
          className="w-full bg-[#0f0f0f] border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-gold mb-2 resize-none"
          style={{ minHeight: 90 }}
        />

        <div className="flex items-center justify-between text-xs text-zinc-400 mb-3">
          <div>
            {wordCount}/{MAX_WORDS} words
          </div>
          {wordCount >= MAX_WORDS ? (
            <div className="text-red-300">Limit reached</div>
          ) : null}
        </div>

        {/* Preview */}
        {mediaPreviewUrl ? (
          <div className="mb-3 rounded-lg border border-zinc-800 p-2 bg-black/30">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-zinc-400">
                {mediaType === "video" ? "Video preview" : "Image preview"}
              </div>
              <button
                type="button"
                onClick={clearMedia}
                className="text-[10px] text-zinc-300 hover:text-white"
              >
                Remove
              </button>
            </div>

            {mediaType === "video" ? (
              <>
                <video
                  key={mediaPreviewUrl} // ✅ forces refresh in picky WebViews
                  src={mediaPreviewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  poster={videoThumbUrl || undefined}
                  onError={() => {
                    setVideoPreviewError(
                      "This video can't be previewed on this device (codec not supported). It can still upload.",
                    );
                  }}
                  className="w-full max-h-72 rounded-lg border border-zinc-900 object-cover"
                />

                {videoPreviewError ? (
                  <div className="mt-2 text-[11px] text-red-300">
                    {videoPreviewError}
                  </div>
                ) : null}
              </>
            ) : (
              <img
                src={mediaPreviewUrl}
                alt="preview"
                className="w-full max-h-72 rounded-lg border border-zinc-900 object-cover"
              />
            )}

            {/* Image actions */}
            {mediaType === "image" ? (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setCropOpen(true)}
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-900"
                  disabled={uploading || posting}
                >
                  Crop (optional)
                </button>
              </div>
            ) : null}

            {/* Video trim UI (drag timeline + blurred removed zones) */}
            {mediaType === "video" ? (
              <div className="mt-3 rounded-lg border border-zinc-800 bg-black/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] text-zinc-300">
                    Trim:{" "}
                    <span className="text-white font-semibold">
                      {formatTime(trimStart)} – {formatTime(trimEnd)}
                    </span>
                  </div>

                  <div className="text-[11px] text-zinc-400">
                    Duration:{" "}
                    <span className="text-zinc-200">
                      {videoDuration ? formatTime(videoDuration) : "…"}
                    </span>
                  </div>
                </div>

                {trimUnavailable ? (
                  <div className="text-[11px] text-red-300 mb-2">
                    Video trimming is unavailable on this device right now.
                  </div>
                ) : mustTrim ? (
                  <div className="text-[11px] text-red-300 mb-2">
                    Longer than 2:00 — trimming is required.
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-500 mb-2">
                    Trimming is optional.
                  </div>
                )}

                {/* Timeline bar */}
                <div className="relative h-11 rounded-lg border border-zinc-800 overflow-hidden bg-black mb-3">
                  {/* base timeline */}
                  <div className="absolute inset-0 bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900" />

                  {/* left removed (blur overlay) */}
                  <div
                    className="absolute inset-y-0 left-0 bg-black/55 backdrop-blur-sm"
                    style={{ width: `${pct(trimStart, videoDuration)}%` }}
                  />

                  {/* right removed (blur overlay) */}
                  <div
                    className="absolute inset-y-0 right-0 bg-black/55 backdrop-blur-sm"
                    style={{ width: `${100 - pct(trimEnd, videoDuration)}%` }}
                  />

                  {/* selected window highlight */}
                  <div
                    className="absolute inset-y-0 bg-gold/25 border-x border-gold/70"
                    style={{
                      left: `${pct(trimStart, videoDuration)}%`,
                      width: `${Math.max(
                        0,
                        pct(Number(trimEnd) - Number(trimStart), videoDuration),
                      )}%`,
                    }}
                  />

                  {/* handle markers */}
                  <div
                    className="absolute top-0 bottom-0 w-[3px] bg-gold"
                    style={{ left: `${pct(trimStart, videoDuration)}%` }}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-[3px] bg-gold"
                    style={{ left: `${pct(trimEnd, videoDuration)}%` }}
                  />

                  {/* labels inside bar */}
                  <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px] text-zinc-200 pointer-events-none">
                    <div>{formatTime(trimStart)}</div>
                    <div>{formatTime(trimEnd)}</div>
                  </div>
                </div>

                {/* Drag handles (2 sliders) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-12 text-[10px] text-zinc-400">Start</div>
                    <input
                      type="range"
                      min="0"
                      max={Math.max(0, Math.floor(videoDuration || 0))}
                      value={Number(trimStart) || 0}
                      onChange={(e) => {
                        const next = Number(e.target.value || 0);
                        const end = Number(trimEnd) || 0;
                        setTrimStart(Math.min(next, Math.max(0, end - 1)));
                      }}
                      className="w-full"
                      disabled={
                        trimming || uploading || posting || !videoDuration
                      }
                    />
                    <div className="w-12 text-[10px] text-zinc-300 text-right">
                      {formatTime(trimStart)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-12 text-[10px] text-zinc-400">End</div>
                    <input
                      type="range"
                      min="0"
                      max={Math.max(0, Math.floor(videoDuration || 0))}
                      value={Number(trimEnd) || 0}
                      onChange={(e) => {
                        const next = Number(e.target.value || 0);
                        const start = Number(trimStart) || 0;
                        setTrimEnd(Math.max(next, start + 1));
                      }}
                      className="w-full"
                      disabled={
                        trimming || uploading || posting || !videoDuration
                      }
                    />
                    <div className="w-12 text-[10px] text-zinc-300 text-right">
                      {formatTime(trimEnd)}
                    </div>
                  </div>
                </div>

                {/* hard-limit hint (small) */}
                {videoDuration &&
                Number(trimEnd) - Number(trimStart) > MAX_VIDEO_SECONDS ? (
                  <div className="mt-2 text-[11px] text-red-300">
                    Selected range is more than 2:00 — reduce it.
                  </div>
                ) : null}

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTrimStart(0);
                      setTrimEnd(
                        Math.min(
                          MAX_VIDEO_SECONDS,
                          Math.floor(videoDuration || MAX_VIDEO_SECONDS),
                        ),
                      );
                      toast.info("Trim reset to 0–2:00.");
                    }}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-900"
                    disabled={
                      trimming || uploading || posting || !videoDuration
                    }
                  >
                    Reset 0–2:00
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (trimUnavailable) {
                        toast.error(
                          "Video trimming is unavailable on this device right now.",
                        );
                        return;
                      }

                      if (
                        Number(trimEnd) - Number(trimStart) >
                        MAX_VIDEO_SECONDS
                      ) {
                        toast.error("Trim must be 2:00 max. Reduce the range.");
                        return;
                      }

                      applyVideoTrim();
                    }}
                    className="ml-auto rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50"
                    disabled={
                      trimUnavailable ||
                      trimming ||
                      uploading ||
                      posting ||
                      !videoDuration ||
                      !(Number(trimEnd) > Number(trimStart))
                    }
                  >
                    {trimming
                      ? "Trimming…"
                      : mustTrim
                      ? "Trim (required)"
                      : "Trim"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Controls */}
        <div className="flex items-center gap-2 mb-3">
          {/* Camera */}
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="rounded-md border border-emerald-600 px-3 py-1.5 text-xs hover:bg-emerald-900/30"
            disabled={uploading || posting}
          >
            Camera
          </button>

          {/* Gallery */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-900"
            disabled={uploading || posting}
          >
            {mediaFile ? "Change media" : "Add media"}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0])}
          />

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*,video/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0])}
          />

          <button
            type="button"
            onClick={submit}
            disabled={!canPost}
            className="ml-auto rounded-lg bg-gold text-black px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {posting ? "Posting…" : uploading ? "Uploading…" : "Post"}
          </button>
        </div>
      </div>

      {/* Crop modal */}
      <ImageCropperModal
        open={cropOpen}
        src={mediaPreviewUrl}
        aspect={1}
        onCancel={() => setCropOpen(false)}
        onDone={(blob) => {
          try {
            const file = new File([blob], "cropped.jpg", {
              type: blob.type || "image/jpeg",
            });
            const url = URL.createObjectURL(file);

            try {
              if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
            } catch {}

            setMediaFile(file);
            setMediaType("image");
            setMediaPreviewUrl(url);
            toast.success("Crop applied.");
          } finally {
            setCropOpen(false);
          }
        }}
      />
    </div>
  );
}
