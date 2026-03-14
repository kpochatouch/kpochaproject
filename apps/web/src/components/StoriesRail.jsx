//apps/web/src/components/StoriesRail.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useMe } from "../context/MeContext.jsx";
import { attachHlsToVideo, isHlsUrl } from "../lib/hlsAttach";

function timeLeftLabel(expiresAt) {
  if (!expiresAt) return "";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "expiring";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h left`;
}

function storyThumb(story) {
  const m = Array.isArray(story?.media) ? story.media[0] : null;
  if (!m) return story?.authorAvatar || "";
  return m.thumbnailUrl || m.url || story?.authorAvatar || "";
}

function storyMedia(story) {
  const m = Array.isArray(story?.media) ? story.media[0] : null;
  return m || null;
}

export default function StoriesRail({
  className = "",
  limit = 50,
  showCreate = true,
}) {
  const navigate = useNavigate();
  const { me } = useMe();

  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const videoRef = useRef(null);
  const hlsCleanupRef = useRef(null);
  const hlsSrcRef = useRef("");

  async function loadStories() {
    try {
      setLoading(true);
      const res = await api.get("/api/stories/public", {
        params: { limit },
      });

      const list = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.items)
        ? res.data.items
        : [];

      setStories(list);
    } catch {
      setStories([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStories();
  }, [limit]);

  const items = useMemo(() => stories || [], [stories]);
  const activeStory = viewerOpen ? items[viewerIndex] || null : null;
  const activeMedia = activeStory ? storyMedia(activeStory) : null;
  const activeIsVideo = activeMedia?.type === "video";

  function openCreate() {
    navigate("/stories/create");
  }

  function openViewer(index) {
    setViewerIndex(index);
    setViewerOpen(true);
  }

  function closeViewer() {
    setViewerOpen(false);
  }

  function prevStory() {
    setViewerIndex((i) => Math.max(0, i - 1));
  }

  function nextStory() {
    setViewerIndex((i) => Math.min(items.length - 1, i + 1));
  }

  useEffect(() => {
    return () => {
      if (hlsCleanupRef.current) {
        try {
          hlsCleanupRef.current();
        } catch {}
        hlsCleanupRef.current = null;
        hlsSrcRef.current = "";
      }
    };
  }, []);

  useEffect(() => {
    async function bindVideo() {
      if (!viewerOpen || !activeIsVideo) return;
      const el = videoRef.current;
      const src = activeMedia?.url || "";
      if (!el || !src) return;

      if (isHlsUrl(src)) {
        if (hlsCleanupRef.current) {
          try {
            hlsCleanupRef.current();
          } catch {}
          hlsCleanupRef.current = null;
          hlsSrcRef.current = "";
        }

        const cleanup = await attachHlsToVideo(el, src);
        hlsCleanupRef.current = cleanup;
        hlsSrcRef.current = src;

        try {
          el.play().catch(() => {});
        } catch {}
        return;
      }

      if (hlsCleanupRef.current) {
        try {
          hlsCleanupRef.current();
        } catch {}
        hlsCleanupRef.current = null;
        hlsSrcRef.current = "";
      }

      try {
        el.src = src;
        el.setAttribute("src", src);
        el.load();
        el.play().catch(() => {});
      } catch {}
    }

    bindVideo();

    return () => {
      if (hlsCleanupRef.current) {
        try {
          hlsCleanupRef.current();
        } catch {}
        hlsCleanupRef.current = null;
        hlsSrcRef.current = "";
      }

      const el = videoRef.current;
      if (el) {
        try {
          el.pause();
        } catch {}
        try {
          el.removeAttribute("src");
          el.load();
        } catch {}
      }
    };
  }, [viewerOpen, viewerIndex, activeIsVideo, activeMedia?.url]);

  return (
    <>
      <div className={`mb-4 ${className}`}>
        <div className="overflow-x-auto no-scrollbar">
          <div className="flex items-start gap-3 min-w-max">
            {showCreate && me ? (
              <button
                type="button"
                onClick={openCreate}
                className="shrink-0 w-[108px] rounded-2xl overflow-hidden border border-zinc-800 bg-[#111] hover:bg-[#151515] transition"
                aria-label="Create story"
              >
                <div className="h-[145px] relative bg-zinc-900 flex items-end justify-center">
                  <div className="absolute inset-0 bg-gradient-to-b from-zinc-800/40 to-black/20" />
                  <div className="absolute bottom-8 w-10 h-10 rounded-full bg-gold text-black flex items-center justify-center text-3xl leading-none border-4 border-[#111]">
                    +
                  </div>
                </div>
                <div className="px-2 py-2 text-xs text-white font-medium text-center">
                  Create story
                </div>
              </button>
            ) : null}

            {loading ? (
              <div className="text-sm text-zinc-500 px-1 py-3">
                Loading stories…
              </div>
            ) : items.length ? (
              items.map((story, index) => {
                const thumb = storyThumb(story);
                const authorName = story?.authorName || "Professional";
                const expires = timeLeftLabel(story?.expiresAt);

                return (
                  <button
                    key={story._id || story.id || index}
                    type="button"
                    onClick={() => openViewer(index)}
                    className="relative shrink-0 w-[108px] h-[190px] rounded-2xl overflow-hidden border border-zinc-800 bg-black group"
                    aria-label={`Open story by ${authorName}`}
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={authorName}
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-zinc-900" />
                    )}

                    <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/80" />

                    <div className="absolute top-2 left-2">
                      <div className="w-10 h-10 rounded-full p-[2px] bg-gradient-to-br from-gold via-yellow-500 to-orange-500">
                        <div className="w-full h-full rounded-full overflow-hidden bg-zinc-800">
                          {story?.authorAvatar ? (
                            <img
                              src={story.authorAvatar}
                              alt={authorName}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-white">
                              {authorName.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="absolute left-2 right-2 bottom-2 text-left">
                      <div className="text-xs font-semibold text-white line-clamp-2">
                        {authorName}
                      </div>
                      {expires ? (
                        <div className="text-[10px] text-zinc-300 mt-0.5">
                          {expires}
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="text-sm text-zinc-500 px-1 py-3">
                No stories yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {viewerOpen && activeStory && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center px-3 py-4">
          <div className="relative w-full max-w-md h-[86vh] rounded-3xl overflow-hidden border border-zinc-800 bg-black">
            <button
              type="button"
              onClick={closeViewer}
              className="absolute top-3 right-3 z-20 w-10 h-10 rounded-full bg-black/45 text-white text-xl"
              aria-label="Close story viewer"
            >
              ×
            </button>

            {viewerIndex > 0 && (
              <button
                type="button"
                onClick={prevStory}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/45 text-white text-xl"
                aria-label="Previous story"
              >
                ‹
              </button>
            )}

            {viewerIndex < items.length - 1 && (
              <button
                type="button"
                onClick={nextStory}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/45 text-white text-xl"
                aria-label="Next story"
              >
                ›
              </button>
            )}

            <div className="absolute inset-x-0 top-0 z-10 p-4 bg-gradient-to-b from-black/70 to-transparent">
              <div className="flex items-center gap-3 pr-12">
                <div className="w-11 h-11 rounded-full overflow-hidden bg-zinc-800">
                  {activeStory?.authorAvatar ? (
                    <img
                      src={activeStory.authorAvatar}
                      alt={activeStory.authorName || "Professional"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-sm text-white">
                      {(activeStory?.authorName || "P")
                        .slice(0, 1)
                        .toUpperCase()}
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {activeStory?.authorName || "Professional"}
                  </div>
                  <div className="text-[11px] text-zinc-300">
                    {timeLeftLabel(activeStory?.expiresAt) || "Story"}
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute inset-0">
              {activeIsVideo ? (
                <video
                  ref={videoRef}
                  controls
                  playsInline
                  autoPlay
                  className="w-full h-full object-cover bg-black"
                  poster={activeMedia?.thumbnailUrl || undefined}
                />
              ) : (
                <img
                  src={activeMedia?.url || ""}
                  alt={activeStory?.authorName || "Story"}
                  className="w-full h-full object-cover"
                />
              )}
            </div>

            {(activeStory?.text || "").trim() ? (
              <div className="absolute inset-x-0 bottom-0 z-10 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <div className="text-sm text-white whitespace-pre-wrap">
                  {activeStory.text}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
