//apps/web/src/pages/StoryCompose.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { uploadMediaAsset } from "../lib/r2Upload";
import { useToast } from "../components/Toast.jsx";
import ImageCropperModal from "../components/ImageCropper.jsx";

const MAX_STORY_WORDS = 80;
const MAX_IMAGE_MB = 10;
const MAX_VIDEO_MB = 80;
const MAX_VIDEO_SECONDS = 30;

function wordsCount(s) {
  return String(s || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function trimToWords(s, maxWords) {
  const arr = String(s || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return arr.slice(0, maxWords).join(" ");
}

function detectIsVideo(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
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

      v.onerror = () => cleanup("");

      v.onloadedmetadata = () => {
        try {
          const t = Math.min(0.1, Math.max(0, (v.duration || 0) * 0.05));
          v.currentTime = Number.isFinite(t) ? t : 0;
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

      v.load();
    } catch {
      try {
        if (url) URL.revokeObjectURL(url);
      } catch {}
      resolve("");
    }
  });
}

export default function StoryCompose() {
  const navigate = useNavigate();
  const toast = useToast();

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const [text, setText] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const [mediaType, setMediaType] = useState("image");
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoThumbUrl, setVideoThumbUrl] = useState("");
  const [videoPreviewError, setVideoPreviewError] = useState("");
  const [cropOpen, setCropOpen] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);

  const wordCount = useMemo(() => wordsCount(text), [text]);
  const canPost = useMemo(() => {
    if (!mediaFile) return false;
    if (uploading || posting) return false;
    return true;
  }, [mediaFile, uploading, posting]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

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

  function clearMedia() {
    setMediaFile(null);
    setMediaType("image");
    setVideoDuration(0);
    setVideoPreviewError("");

    try {
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    } catch {}
    setMediaPreviewUrl("");

    try {
      if (videoThumbUrl) URL.revokeObjectURL(videoThumbUrl);
    } catch {}
    setVideoThumbUrl("");

    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  async function onPickFile(file) {
    if (!file) return;

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

    const previewUrl = URL.createObjectURL(file);
    try {
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    } catch {}
    setMediaPreviewUrl(previewUrl);

    setMediaFile(file);
    setMediaType(isVideo ? "video" : "image");
    setVideoPreviewError("");

    if (!isVideo) {
      try {
        if (videoThumbUrl) URL.revokeObjectURL(videoThumbUrl);
      } catch {}
      setVideoThumbUrl("");
      setVideoDuration(0);
      toast.success("Story image selected.");
      return;
    }

    const dur = await getVideoDurationSeconds(file);
    setVideoDuration(dur || 0);

    if (dur && dur > MAX_VIDEO_SECONDS) {
      clearMedia();
      toast.error("Story videos must be 30 seconds max.");
      return;
    }

    const thumb = await makeVideoThumbnail(file);

    try {
      if (videoThumbUrl) URL.revokeObjectURL(videoThumbUrl);
    } catch {}
    setVideoThumbUrl(thumb || "");

    toast.success("Story video selected.");
  }

  async function submit() {
    if (!mediaFile) {
      toast.error("Add image or video for the story.");
      return;
    }

    if (wordCount > MAX_STORY_WORDS) {
      toast.error(`Max ${MAX_STORY_WORDS} words.`);
      return;
    }

    try {
      setPosting(true);
      setUploading(true);

      toast.info("Uploading story media…");

      const main = await uploadMediaAsset({
        api,
        file: mediaFile,
        type: mediaType,
        visibility: "public",
      });

      let thumbAssetId = "";

      if (mediaType === "video" && videoThumbUrl) {
        try {
          const blob = await fetch(videoThumbUrl).then((r) => r.blob());
          const thumbFile = new File([blob], "story-thumb.jpg", {
            type: blob.type || "image/jpeg",
          });

          const thumb = await uploadMediaAsset({
            api,
            file: thumbFile,
            type: "image",
            visibility: "public",
          });

          thumbAssetId = thumb.assetId || "";
        } catch {}
      }

      setUploading(false);
      toast.info("Posting story…");

      await api.post("/api/stories", {
        text: text.trim(),
        media: [
          {
            assetId: main.assetId,
            type: mediaType,
            ...(thumbAssetId ? { thumbnailAssetId: thumbAssetId } : {}),
          },
        ],
        isPublic: true,
        tags: [],
      });

      toast.success("Story posted!");
      navigate("/browse");
    } catch (e) {
      setUploading(false);
      toast.error(
        e?.response?.data?.error || e?.message || "Story post failed.",
      );
    } finally {
      setPosting(false);
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Create Story</h1>
          <button
            type="button"
            onClick={close}
            className="text-sm text-zinc-300 hover:text-white"
          >
            Close
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            const wc = wordsCount(raw);
            if (wc <= MAX_STORY_WORDS) {
              setText(raw);
            } else {
              setText(trimToWords(raw, MAX_STORY_WORDS));
            }
          }}
          placeholder="Add a short caption (optional)…"
          className="w-full bg-[#0f0f0f] border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-gold mb-2 resize-none"
          style={{ minHeight: 72 }}
        />

        <div className="flex items-center justify-between text-xs text-zinc-400 mb-3">
          <div>
            {wordCount}/{MAX_STORY_WORDS} words
          </div>
          {wordCount >= MAX_STORY_WORDS ? (
            <div className="text-red-300">Limit reached</div>
          ) : null}
        </div>

        {mediaPreviewUrl ? (
          <div className="mb-3 rounded-lg border border-zinc-800 p-2 bg-black/30">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-zinc-400">
                {mediaType === "video"
                  ? "Story video preview"
                  : "Story image preview"}
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
                  key={mediaPreviewUrl}
                  src={mediaPreviewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  poster={videoThumbUrl || undefined}
                  onError={() => {
                    setVideoPreviewError(
                      "This video can't be previewed on this device. It can still upload.",
                    );
                  }}
                  className="w-full max-h-[70vh] rounded-lg border border-zinc-900 object-cover"
                />
                {videoDuration ? (
                  <div className="mt-2 text-[11px] text-zinc-400">
                    Duration: {Math.floor(videoDuration)}s / {MAX_VIDEO_SECONDS}
                    s max
                  </div>
                ) : null}
                {videoPreviewError ? (
                  <div className="mt-2 text-[11px] text-red-300">
                    {videoPreviewError}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <img
                  src={mediaPreviewUrl}
                  alt="story preview"
                  className="w-full max-h-[70vh] rounded-lg border border-zinc-900 object-cover"
                />
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
              </>
            )}
          </div>
        ) : null}

        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="rounded-md border border-emerald-600 px-3 py-1.5 text-xs hover:bg-emerald-900/30"
            disabled={uploading || posting}
          >
            Camera
          </button>

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
            {posting ? "Posting…" : uploading ? "Uploading…" : "Post Story"}
          </button>
        </div>
      </div>

      <ImageCropperModal
        open={cropOpen}
        src={mediaPreviewUrl}
        aspect={9 / 16}
        onCancel={() => setCropOpen(false)}
        onDone={(blob) => {
          try {
            const file = new File([blob], "story-cropped.jpg", {
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
