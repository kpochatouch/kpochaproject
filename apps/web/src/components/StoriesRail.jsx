//apps/web/src/components/StoriesRail.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useMe } from "../context/MeContext.jsx";
import { attachHlsToVideo, isHlsUrl } from "../lib/hlsAttach";
import AdvertStoryCard from "./AdvertStoryCard.jsx";
import { handleAdvertClick as runAdvertClick } from "../lib/advertActions";

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
  const [storyAdverts, setStoryAdverts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const [pendingStoryUpload, setPendingStoryUpload] = useState(null);
  const uploadPollRef = useRef(null);
  const clearPendingRef = useRef(null);
  const didInitialLoadRef = useRef(false);

  const videoRef = useRef(null);
  const hlsCleanupRef = useRef(null);
  const hlsSrcRef = useRef("");

  async function loadStories({ silent = false } = {}) {
    const shouldShowInitialLoader = !didInitialLoadRef.current && !silent;

    try {
      if (shouldShowInitialLoader) setLoading(true);

      const res = await api.get("/api/stories/public", {
        params: { limit },
      });

      const list = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.items)
        ? res.data.items
        : [];

      setStories(list);
      didInitialLoadRef.current = true;
    } catch {
      if (!didInitialLoadRef.current) {
        setStories([]);
      }
    } finally {
      if (shouldShowInitialLoader) setLoading(false);
    }
  }

  async function loadStoryAdverts() {
    try {
      const res = await api.get("/api/adverts/active/list", {
        params: { placement: "stories" },
      });

      const list = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.items)
        ? res.data.items
        : [];

      setStoryAdverts(list);
    } catch {
      setStoryAdverts([]);
    }
  }

  function readPendingStoryUpload() {
    try {
      const raw = sessionStorage.getItem("kpocha:pendingStoryUpload");
      if (!raw) {
        setPendingStoryUpload(null);
        return null;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        setPendingStoryUpload(null);
        return null;
      }

      setPendingStoryUpload(parsed);
      return parsed;
    } catch {
      setPendingStoryUpload(null);
      return null;
    }
  }

  function clearPendingStoryUpload() {
    try {
      sessionStorage.removeItem("kpocha:pendingStoryUpload");
    } catch {}

    setPendingStoryUpload(null);

    try {
      window.dispatchEvent(new Event("kpocha:story-upload-state"));
    } catch {}
  }

  function dismissPendingStoryUpload() {
    clearPendingStoryUpload();
  }

  useEffect(() => {
    didInitialLoadRef.current = false;
    loadStories({ silent: false });
    loadStoryAdverts();
  }, [limit]);

  useEffect(() => {
    readPendingStoryUpload();

    const onFocus = () => readPendingStoryUpload();
    const onStoryUploadState = () => readPendingStoryUpload();

    window.addEventListener("focus", onFocus);
    window.addEventListener("kpocha:story-upload-state", onStoryUploadState);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "kpocha:story-upload-state",
        onStoryUploadState,
      );
    };
  }, []);

  useEffect(() => {
    if (uploadPollRef.current) {
      clearInterval(uploadPollRef.current);
      uploadPollRef.current = null;
    }

    if (!pendingStoryUpload) return;

    if (
      pendingStoryUpload.status === "uploading" ||
      pendingStoryUpload.status === "processing" ||
      pendingStoryUpload.status === "publishing" ||
      pendingStoryUpload.status === "success"
    ) {
      uploadPollRef.current = setInterval(() => {
        loadStories({ silent: true });
      }, 2000);
    }

    return () => {
      if (uploadPollRef.current) {
        clearInterval(uploadPollRef.current);
        uploadPollRef.current = null;
      }
    };
  }, [pendingStoryUpload]);

  useEffect(() => {
    if (!pendingStoryUpload) return;
    if (!me?.uid) return;

    const targetStoryId = String(pendingStoryUpload?.storyId || "").trim();

    const createdStory = targetStoryId
      ? (stories || []).find(
          (s) => String(s?._id || s?.id || "") === targetStoryId,
        )
      : null;

    const mine = (stories || []).filter(
      (s) => String(s?.ownerUid || s?.proOwnerUid || "") === String(me.uid),
    );

    const matchedStory = createdStory || mine[0] || null;
    if (!matchedStory) return;

    if (clearPendingRef.current) {
      clearTimeout(clearPendingRef.current);
      clearPendingRef.current = null;
    }

    clearPendingRef.current = setTimeout(() => {
      clearPendingStoryUpload();
      clearPendingRef.current = null;
    }, 1200);

    return () => {
      if (clearPendingRef.current) {
        clearTimeout(clearPendingRef.current);
        clearPendingRef.current = null;
      }
    };
  }, [pendingStoryUpload, stories, me?.uid]);

  useEffect(() => {
    if (!pendingStoryUpload) return;
    if (pendingStoryUpload.status !== "error") return;

    if (clearPendingRef.current) {
      clearTimeout(clearPendingRef.current);
      clearPendingRef.current = null;
    }

    clearPendingRef.current = setTimeout(() => {
      clearPendingStoryUpload();
      clearPendingRef.current = null;
    }, 5000);

    return () => {
      if (clearPendingRef.current) {
        clearTimeout(clearPendingRef.current);
        clearPendingRef.current = null;
      }
    };
  }, [pendingStoryUpload]);

  useEffect(() => {
    return () => {
      if (uploadPollRef.current) {
        clearInterval(uploadPollRef.current);
        uploadPollRef.current = null;
      }
      if (clearPendingRef.current) {
        clearTimeout(clearPendingRef.current);
        clearPendingRef.current = null;
      }
    };
  }, []);

  const items = useMemo(() => {
    const realStories = Array.isArray(stories) ? stories : [];
    const adverts = Array.isArray(storyAdverts) ? storyAdverts : [];

    if (!realStories.length) {
      return adverts.map((ad, index) => ({
        kind: "advert",
        data: ad,
        key: ad?._id || `story-ad-${index}`,
      }));
    }

    const out = [];
    let advertIndex = 0;

    realStories.forEach((story, index) => {
      out.push({
        kind: "story",
        data: story,
        key: story?._id || story?.id || `story-${index}`,
      });

      const shouldInsertAdvert = (index + 1) % 3 === 0;
      if (shouldInsertAdvert && adverts[advertIndex]) {
        out.push({
          kind: "advert",
          data: adverts[advertIndex],
          key: adverts[advertIndex]?._id || `story-ad-${advertIndex}`,
        });
        advertIndex += 1;
      }
    });

    return out;
  }, [stories, storyAdverts]);
  const activeItem = viewerOpen ? items[viewerIndex] || null : null;
  const activeStory = activeItem?.kind === "story" ? activeItem.data : null;
  const activeAdvert = activeItem?.kind === "advert" ? activeItem.data : null;
  const activeMedia = activeStory
    ? storyMedia(activeStory)
    : activeAdvert?.media?.[0] || null;
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

  async function handleAdvertClick(advert) {
    await runAdvertClick({ advert, navigate });
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

      const el = videoRef.current;
      if (el) {
        try {
          el.pause();
        } catch {}

        try {
          el.removeAttribute("src");
        } catch {}

        try {
          el.src = "";
        } catch {}

        try {
          el.srcObject = null;
        } catch {}

        try {
          el.load();
        } catch {}
      }

      try {
        if (navigator.mediaSession?.metadata) {
          navigator.mediaSession.metadata = null;
        }
      } catch {}

      try {
        if (navigator.mediaSession?.setActionHandler) {
          navigator.mediaSession.setActionHandler("play", null);
          navigator.mediaSession.setActionHandler("pause", null);
          navigator.mediaSession.setActionHandler("seekbackward", null);
          navigator.mediaSession.setActionHandler("seekforward", null);
          navigator.mediaSession.setActionHandler("previoustrack", null);
          navigator.mediaSession.setActionHandler("nexttrack", null);
        }
      } catch {}
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
      <div className={`mb-5 ${className}`}>
        <div className="overflow-x-auto no-scrollbar">
          <div className="flex items-start gap-3 min-w-max pb-1">
            {showCreate && me ? (
              <>
                <button
                  type="button"
                  onClick={openCreate}
                  className="shrink-0 w-[108px] rounded-2xl overflow-hidden border transition"
                  style={{
                    borderColor: "var(--app-border)",
                    backgroundColor: "var(--app-surface)",
                    color: "var(--app-text)",
                  }}
                  aria-label="Create story"
                >
                  <div
                    className="h-[145px] relative flex items-end justify-center"
                    style={{ backgroundColor: "var(--app-surface-2)" }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/5" />
                    <div className="absolute bottom-8 w-10 h-10 rounded-full bg-gold text-black flex items-center justify-center text-3xl leading-none border-4 border-[#111]">
                      +
                    </div>
                  </div>

                  <div
                    className="px-2 py-2 text-[13px] font-medium text-center"
                    style={{ color: "var(--app-text)" }}
                  >
                    Create story
                  </div>
                </button>

                {pendingStoryUpload ? (
                  <div
                    className="relative shrink-0 w-[108px] rounded-2xl overflow-hidden border"
                    style={{
                      borderColor:
                        pendingStoryUpload.status === "error"
                          ? "#ef4444"
                          : "#d4af37",
                      backgroundColor: "var(--app-surface)",
                      color: "var(--app-text)",
                    }}
                    aria-label="Pending story upload"
                  >
                    <div
                      className="h-[145px] relative flex flex-col items-center justify-center px-3 text-center"
                      style={{ backgroundColor: "var(--app-surface-2)" }}
                    >
                      <button
                        type="button"
                        onClick={dismissPendingStoryUpload}
                        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 text-white text-xs"
                        aria-label="Dismiss pending story"
                        title="Dismiss"
                      >
                        ×
                      </button>

                      {pendingStoryUpload.status === "uploading" ||
                      pendingStoryUpload.status === "processing" ||
                      pendingStoryUpload.status === "publishing" ? (
                        <div className="w-9 h-9 rounded-full border-2 border-white/25 border-t-gold animate-spin mb-3" />
                      ) : pendingStoryUpload.status === "success" ? (
                        <div className="mb-3 w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center text-lg font-bold">
                          ✓
                        </div>
                      ) : (
                        <div className="mb-3 w-9 h-9 rounded-full bg-red-500 text-white flex items-center justify-center text-lg font-bold">
                          !
                        </div>
                      )}

                      <div className="text-[11px] font-semibold text-white leading-tight">
                        {pendingStoryUpload.status === "uploading"
                          ? "Uploading"
                          : pendingStoryUpload.status === "publishing"
                          ? "Publishing"
                          : pendingStoryUpload.status === "processing"
                          ? "Finishing"
                          : pendingStoryUpload.status === "success"
                          ? "Uploaded"
                          : "Failed"}
                      </div>
                    </div>

                    <div
                      className="px-2 py-2 text-[13px] font-medium text-center"
                      style={{ color: "var(--app-text)" }}
                    >
                      {pendingStoryUpload.status === "uploading"
                        ? "Uploading story"
                        : pendingStoryUpload.status === "publishing"
                        ? "Publishing story"
                        : pendingStoryUpload.status === "processing"
                        ? "Finishing video"
                        : pendingStoryUpload.status === "success"
                        ? "Story uploaded"
                        : "Upload failed"}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {loading ? (
              <div className="text-sm text-zinc-500 px-1 py-3">
                Loading stories…
              </div>
            ) : items.length ? (
              items.map((item, index) => {
                if (item.kind === "advert") {
                  return (
                    <div
                      key={item.key}
                      className="relative shrink-0 w-[108px] h-[190px] rounded-2xl overflow-hidden border"
                      style={{
                        borderColor: "var(--app-border)",
                        backgroundColor: "var(--app-surface)",
                      }}
                    >
                      <AdvertStoryCard
                        advert={item.data}
                        onClickAction={handleAdvertClick}
                      />
                    </div>
                  );
                }

                const story = item.data;
                const thumb = storyThumb(story);
                const authorName = story?.authorName || "Professional";
                const expires = timeLeftLabel(story?.expiresAt);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => openViewer(index)}
                    className="relative shrink-0 w-[108px] h-[190px] rounded-2xl overflow-hidden border group"
                    style={{
                      borderColor: "var(--app-border)",
                      backgroundColor: "var(--app-surface)",
                    }}
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

      {viewerOpen && activeItem && (
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

            {activeStory ? (
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
            ) : activeAdvert ? (
              <div className="absolute inset-x-0 top-0 z-10 p-4 bg-gradient-to-b from-black/70 to-transparent">
                <div className="text-xs uppercase tracking-wide text-white/80">
                  Sponsored
                </div>
              </div>
            ) : null}

            <div className="absolute inset-0">
              {activeAdvert ? (
                <AdvertStoryCard
                  advert={activeAdvert}
                  onClickAction={handleAdvertClick}
                />
              ) : activeIsVideo ? (
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

            {activeStory && (activeStory?.text || "").trim() ? (
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
