//apps/web/src/pages/ForYou.jsx
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fetchPostStats, recordPostView } from "../lib/postStats";
import { useMe } from "../context/MeContext.jsx";
import { Capacitor } from "@capacitor/core";
import { openNativeFeed } from "../lib/nativeFeed";
import { attachHlsToVideo, isHlsUrl } from "../lib/hlsAttach";
import RouteLoader from "../components/RouteLoader.jsx";

function timeAgo(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
}

function formatTime(sec = 0) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function firstMedia(post) {
  return Array.isArray(post?.media) && post.media.length ? post.media[0] : null;
}

function getVideoSrc(post) {
  const m = firstMedia(post);
  return (
    String(m?.hlsUrl || "").trim() ||
    String(m?.url || "").trim() ||
    String(m?.secure_url || "").trim() ||
    String(m?.path || "").trim() ||
    String(post?.videoUrl || "").trim() ||
    ""
  );
}

function getThumbSrc(post) {
  const m = firstMedia(post);
  return (
    String(m?.thumbnailUrl || "").trim() ||
    String(m?.thumb || "").trim() ||
    String(m?.poster || "").trim() ||
    String(post?.thumbnailUrl || "").trim() ||
    ""
  );
}

function isVideoPost(post) {
  const m = firstMedia(post);
  if (!m) return false;

  const explicitType = String(m.type || "").toLowerCase() === "video";
  const src = getVideoSrc(post).toLowerCase();

  if (explicitType && src) return true;
  if (!src) return false;

  return (
    src.endsWith(".m3u8") ||
    src.endsWith(".mp4") ||
    src.endsWith(".mov") ||
    src.endsWith(".webm") ||
    src.endsWith(".mkv") ||
    src.includes("/video/")
  );
}

function dedupeById(items = []) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = String(item?._id || item?.id || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function shuffleArray(items = []) {
  const arr = Array.isArray(items) ? [...items] : [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const FOR_YOU_LAST_FIRST_KEY = "kpocha:for-you:last-first-post-id";

function getPostId(post) {
  return String(post?._id || post?.id || "").trim();
}

function pickFreshForYouBatch(items = [], size = 6) {
  const videoPosts = dedupeById(items.filter(isVideoPost));
  if (!videoPosts.length) return [];

  let avoidId = "";
  try {
    avoidId = sessionStorage.getItem(FOR_YOU_LAST_FIRST_KEY) || "";
  } catch {}

  const shuffled = shuffleArray(videoPosts);

  // Prefer a different first video from the previous refresh
  if (
    avoidId &&
    shuffled.length > 1 &&
    getPostId(shuffled[0]) === String(avoidId)
  ) {
    const swapIndex = shuffled.findIndex(
      (p) => getPostId(p) !== String(avoidId),
    );
    if (swapIndex > 0) {
      [shuffled[0], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[0]];
    }
  }

  const batch = shuffled.slice(0, size);

  try {
    const firstId = getPostId(batch[0]);
    if (firstId) sessionStorage.setItem(FOR_YOU_LAST_FIRST_KEY, firstId);
  } catch {}

  return batch;
}

function ForYouDesktopRail() {
  return (
    <aside className="hidden md:flex w-[220px] shrink-0 border-r border-white/10 bg-black text-white flex-col px-5 py-5">
      <Link to="/browse" className="flex items-center gap-2 mb-6">
        <span className="text-[22px] leading-none">♛</span>
        <span className="text-[18px] font-bold">ForYou</span>
      </Link>

      <div className="mb-5">
        <div className="w-full rounded-full bg-white/10 px-4 py-3 text-sm text-white/60">
          Search
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        <Link
          to="/for-you"
          className="rounded-xl px-4 py-3 text-[16px] font-semibold text-[#F5C542] bg-white/5"
        >
          For You
        </Link>

        <Link
          to="/browse"
          className="rounded-xl px-4 py-3 text-[16px] font-medium text-white hover:bg-white/5"
        >
          Discover
        </Link>

        <Link
          to="/inbox"
          className="rounded-xl px-4 py-3 text-[16px] font-medium text-white hover:bg-white/5"
        >
          Inbox
        </Link>

        <Link
          to="/my-bookings"
          className="rounded-xl px-4 py-3 text-[16px] font-medium text-white hover:bg-white/5"
        >
          My Bookings
        </Link>

        <Link
          to="/profile"
          className="rounded-xl px-4 py-3 text-[16px] font-medium text-white hover:bg-white/5"
        >
          Profile
        </Link>

        <Link
          to="/settings"
          className="rounded-xl px-4 py-3 text-[16px] font-medium text-white hover:bg-white/5"
        >
          More
        </Link>
      </nav>
    </aside>
  );
}

export default function ForYou() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me } = useMe();

  const [feedPosts, setFeedPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  const sentinelRef = useRef(null);
  const observerRef = useRef(null);
  const feedPostsRef = useRef([]);
  const lastCursorIdRef = useRef(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    feedPostsRef.current = feedPosts;
  }, [feedPosts]);

  const loadBatch = useCallback(
    async ({ reset = false } = {}) => {
      if (!reset && loadingMoreRef.current) return;

      if (reset) {
        setLoading(true);
        setError("");
      } else {
        loadingMoreRef.current = true;
        setLoadingMore(true);
      }

      try {
        // direct open: /for-you/:id
        if (reset && id) {
          const { data } = await api.get(`/api/posts/${id}`);
          const initial = data || null;

          if (!initial || !initial._id || !isVideoPost(initial)) {
            throw new Error("That video is unavailable.");
          }

          setFeedPosts([initial]);
          feedPostsRef.current = [initial];
          lastCursorIdRef.current = initial._id;
          return;
        }

        // initial For You start
        if (reset) {
          const [publicRes, trendingRes] = await Promise.all([
            api
              .get("/api/posts/public", { params: { limit: 40 } })
              .catch(() => ({ data: [] })),
            api
              .get("/api/posts/trending", { params: { limit: 20 } })
              .catch(() => ({ data: [] })),
          ]);

          const publicItems = Array.isArray(publicRes?.data)
            ? publicRes.data
            : Array.isArray(publicRes?.data?.items)
            ? publicRes.data.items
            : [];

          const trendingItems = Array.isArray(trendingRes?.data)
            ? trendingRes.data
            : Array.isArray(trendingRes?.data?.items)
            ? trendingRes.data.items
            : [];

          const combined = dedupeById([
            ...trendingItems.filter(isVideoPost),
            ...publicItems.filter(isVideoPost),
          ]);

          const initialBatch = pickFreshForYouBatch(combined, 6);

          if (!initialBatch.length) {
            setFeedPosts([]);
            feedPostsRef.current = [];
            lastCursorIdRef.current = null;
            return;
          }

          setFeedPosts(initialBatch);
          feedPostsRef.current = initialBatch;
          lastCursorIdRef.current =
            initialBatch[initialBatch.length - 1]?._id ||
            initialBatch[0]?._id ||
            null;
          return;
        }

        const currentPosts = feedPostsRef.current || [];
        const cursorId =
          lastCursorIdRef.current ||
          currentPosts[currentPosts.length - 1]?._id ||
          null;

        if (!cursorId) return;

        const exclude = currentPosts
          .map((p) => p?._id)
          .filter(Boolean)
          .slice(-100)
          .join(",");

        const res = await api.get(`/api/posts/${cursorId}/next`, {
          params: exclude ? { exclude } : {},
        });

        const nxt = res?.data?.next || null;

        if (!nxt || !nxt._id || !isVideoPost(nxt)) {
          return;
        }

        // small pool support:
        // if backend loops an already-seen post, replace the whole deck
        // with a reshuffled mini-batch starting from that returned post.
        const alreadyLoaded = currentPosts.some(
          (p) => String(p?._id) === String(nxt._id),
        );

        if (alreadyLoaded) {
          const publicRes = await api.get("/api/posts/public", {
            params: { limit: 40 },
          });

          const raw = Array.isArray(publicRes?.data) ? publicRes.data : [];
          const videoPosts = shuffleArray(raw.filter(isVideoPost));

          if (!videoPosts.length) return;

          const rebuilt = dedupeById([nxt, ...videoPosts]).slice(0, 6);
          setFeedPosts(rebuilt);
          feedPostsRef.current = rebuilt;
          lastCursorIdRef.current =
            rebuilt[rebuilt.length - 1]?._id || nxt._id || null;
          return;
        }

        setFeedPosts((prev) => {
          const nextList = dedupeById([...prev, nxt]);
          feedPostsRef.current = nextList;
          return nextList;
        });

        lastCursorIdRef.current = nxt._id;
      } catch (err) {
        if (reset) {
          setError(err?.message || "Unable to load For You feed.");
        }
      } finally {
        if (reset) {
          setLoading(false);
        } else {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [id],
  );

  useEffect(() => {
    feedPostsRef.current = [];
    lastCursorIdRef.current = null;
    setFeedPosts([]);
    setError("");
    loadBatch({ reset: true });
  }, [id, loadBatch]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    if (observerRef.current) {
      try {
        observerRef.current.disconnect();
      } catch {}
      observerRef.current = null;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries?.[0];
        if (!entry?.isIntersecting) return;
        loadBatch({ reset: false });
      },
      {
        root: null,
        rootMargin: "1200px",
        threshold: 0,
      },
    );

    observerRef.current.observe(el);

    return () => {
      try {
        observerRef.current?.disconnect();
      } catch {}
      observerRef.current = null;
    };
  }, [loadBatch]);

  if (loading) return <RouteLoader full />;

  if (error) {
    return (
      <div className="kpo-page-shell max-w-xl mx-auto p-4">
        <div
          className="rounded-2xl border p-6"
          style={{
            background: "var(--app-surface)",
            borderColor: "var(--app-border)",
          }}
        >
          <div className="kpo-page-title-wrap mb-2">
            <div className="kpo-page-eyebrow">Video Feed</div>
            <div className="kpo-page-title">For You</div>
          </div>
          <div className="text-sm" style={{ color: "var(--app-text-soft)" }}>
            {error}
          </div>
          <div className="mt-4">
            <Link to="/browse" className="kpo-page-pill-btn">
              Feed
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!feedPosts.length) {
    return (
      <div className="kpo-page-shell max-w-xl mx-auto p-4">
        <div
          className="rounded-2xl border p-6"
          style={{
            background: "var(--app-surface)",
            borderColor: "var(--app-border)",
          }}
        >
          <div className="kpo-page-title-wrap mb-2">
            <div className="kpo-page-eyebrow">Video Feed</div>
            <div className="kpo-page-title">For You</div>
          </div>
          <div className="text-sm" style={{ color: "var(--app-text-soft)" }}>
            No videos available right now.
          </div>
          <div className="mt-4">
            <Link to="/browse" className="kpo-page-pill-btn">
              Feed
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="kpo-page-shell bg-black flex h-screen overflow-hidden kpo-hide-scroll-x">
      <ForYouDesktopRail />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="kpo-page-header md:hidden">
          <div className="kpo-page-header-left">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="kpo-page-back-btn"
              aria-label="Go back"
            >
              ‹
            </button>

            <div className="kpo-page-title-wrap">
              <div className="kpo-page-eyebrow">Video Feed</div>
              <div className="kpo-page-title">For You</div>
            </div>
          </div>

          <div className="kpo-page-header-right">
            <Link to="/browse" className="kpo-page-pill-btn">
              Feed
            </Link>
          </div>
        </div>

        <div
          className="flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory bg-black kpo-mobile-content"
          style={{
            WebkitOverflowScrolling: "touch",
            scrollSnapType: "y mandatory",
          }}
        >
          {feedPosts.map((post, index) => (
            <ForYouPost
              key={post._id}
              post={post}
              index={index}
              me={me}
              navigate={navigate}
              onNeedMore={() => {
                const remaining = feedPosts.length - 1 - index;
                if (remaining <= 2) loadBatch({ reset: false });
              }}
            />
          ))}

          <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function ForYouPost({ post, index, me, navigate, onNeedMore }) {
  const id = post?._id;

  const [stats, setStats] = useState({
    viewsCount: 0,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    savesCount: 0,
    likedByMe: false,
    savedByMe: false,
  });

  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingLike, setLoadingLike] = useState(false);
  const [loadingSave, setLoadingSave] = useState(false);

  const [showFullCaption, setShowFullCaption] = useState(false);
  const CAPTION_MAX = 110;

  const captionText = String(post?.text || "").trim();
  const captionTooLong = captionText.length > CAPTION_MAX;
  const captionShown =
    !showFullCaption && captionTooLong
      ? captionText.slice(0, CAPTION_MAX) + "…"
      : captionText;

  const videoRef = useRef(null);
  const pageRef = useRef(null);
  const menuRef = useRef(null);

  const hlsCleanupRef = useRef(null);
  const SOUND_KEY = "kpocha_sound_enabled";

  function getSoundEnabled() {
    try {
      return localStorage.getItem(SOUND_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setSoundEnabled(on) {
    try {
      localStorage.setItem(SOUND_KEY, on ? "1" : "0");
    } catch {}
  }

  const [muted, setMuted] = useState(() => !getSoundEnabled());
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);

  const lastTimeUpdateRef = useRef(0);
  const playTriggeredByObserverRef = useRef(false);
  const watchAccumRef = useRef(0);
  const lastWatchTsRef = useRef(0);
  const isActiveRef = useRef(false);
  const statsRevisionRef = useRef(0);

  function claimActiveVideo(vid) {
    try {
      const prev = window.__kpochaActiveVideo;
      if (prev && prev !== vid) {
        try {
          prev.pause();
        } catch {}
      }
      window.__kpochaActiveVideo = vid;
    } catch {}
  }

  const [showControls, setShowControls] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [hasFirstFrame, setHasFirstFrame] = useState(false);

  const media =
    Array.isArray(post?.media) && post.media.length ? post.media[0] : null;

  const videoSrc = getVideoSrc(post);
  const thumbSrc = getThumbSrc(post);

  useEffect(() => {
    const el = pageRef.current;
    const vid = videoRef.current;
    if (!el || !vid || !id) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries?.[0];
        const ratio = entry?.intersectionRatio || 0;
        const isActive = ratio >= 0.9;

        isActiveRef.current = isActive;

        if (isActive) {
          try {
            onNeedMore && onNeedMore();
          } catch {}

          const wantSound = getSoundEnabled();
          vid.muted = !wantSound;
          setMuted(!wantSound);

          claimActiveVideo(vid);
          playTriggeredByObserverRef.current = true;

          vid.play().catch(async () => {
            try {
              vid.muted = true;
              setMuted(true);
              await vid.play();
            } catch {}
          });
        } else {
          try {
            vid.pause();
          } catch {}
        }
      },
      { threshold: [0, 0.5, 0.9, 1] },
    );

    obs.observe(el);

    return () => {
      isActiveRef.current = false;
      try {
        obs.disconnect();
      } catch {}
      try {
        vid.pause();
      } catch {}
    };
  }, [id, index, onNeedMore]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !videoSrc) return;

    let cancelled = false;

    async function tryAutoplayCurrentVideo() {
      if (cancelled) return;
      if (!isActiveRef.current && index !== 0) return;

      const wantSound = getSoundEnabled();
      vid.muted = !wantSound;
      setMuted(!wantSound);

      claimActiveVideo(vid);
      playTriggeredByObserverRef.current = true;

      try {
        await vid.play();
      } catch {
        try {
          vid.muted = true;
          setMuted(true);
          await vid.play();
        } catch {}
      }
    }

    (async () => {
      try {
        if (hlsCleanupRef.current) {
          try {
            hlsCleanupRef.current();
          } catch {}
          hlsCleanupRef.current = null;
        }

        if (isHlsUrl(videoSrc)) {
          try {
            vid.removeAttribute("src");
          } catch {}
          try {
            vid.src = "";
          } catch {}

          const cleanup = await attachHlsToVideo(vid, videoSrc);

          if (cancelled) {
            try {
              cleanup?.();
            } catch {}
            return;
          }

          hlsCleanupRef.current = cleanup;

          tryAutoplayCurrentVideo();
        } else {
          vid.setAttribute("src", videoSrc);
          vid.src = videoSrc;
          try {
            vid.load();
          } catch {}

          tryAutoplayCurrentVideo();
        }
      } catch {
        setVideoError(
          "This video couldn't play here. Tap the video to open it.",
        );
      }
    })();

    return () => {
      cancelled = true;

      if (hlsCleanupRef.current) {
        try {
          hlsCleanupRef.current();
        } catch {}
        hlsCleanupRef.current = null;
      }

      try {
        vid.pause();
      } catch {}
      try {
        vid.removeAttribute("src");
      } catch {}
      try {
        vid.src = "";
      } catch {}
      try {
        vid.load();
      } catch {}
    };
  }, [videoSrc]);

  useEffect(() => {
    if (!id) return;
    let on = true;

    (async () => {
      try {
        const revision = statsRevisionRef.current;
        const srv = await fetchPostStats(id);
        if (!on || revision !== statsRevisionRef.current) return;
        setStats((prev) => ({
          ...prev,
          viewsCount:
            typeof srv.viewsCount === "number"
              ? srv.viewsCount
              : prev.viewsCount,
          likesCount:
            typeof srv.likesCount === "number"
              ? srv.likesCount
              : prev.likesCount,
          commentsCount:
            typeof srv.commentsCount === "number"
              ? srv.commentsCount
              : prev.commentsCount,
          sharesCount:
            typeof srv.sharesCount === "number"
              ? srv.sharesCount
              : prev.sharesCount,
          savesCount:
            typeof srv.savesCount === "number"
              ? srv.savesCount
              : prev.savesCount,
          likedByMe:
            typeof srv.likedByMe === "boolean" ? srv.likedByMe : prev.likedByMe,
          savedByMe:
            typeof srv.savedByMe === "boolean" ? srv.savedByMe : prev.savedByMe,
        }));
      } catch {}
    })();

    return () => {
      on = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let on = true;

    (async () => {
      try {
        const res = await api.get(`/api/posts/${id}/comments`);
        if (on) setComments(res.data || []);
      } catch {}
    })();

    return () => {
      on = false;
    };
  }, [id]);

  useEffect(() => {
    watchAccumRef.current = 0;
    lastWatchTsRef.current = 0;
    lastTimeUpdateRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    setUserHasInteracted(false);
    setMuted(() => !getSoundEnabled());
    setShowControls(false);
    setVideoError("");
    setHasFirstFrame(false);

    if (hlsCleanupRef.current) {
      try {
        hlsCleanupRef.current();
      } catch {}
      hlsCleanupRef.current = null;
    }
  }, [id]);

  useEffect(() => {
    function onGlobalClick(e) {
      if (!menuOpen) return;
      if (!menuRef.current) return;
      const target = e?.detail?.target;
      if (target && menuRef.current.contains(target)) return;
      setMenuOpen(false);
    }

    window.addEventListener("global-click", onGlobalClick);
    return () => window.removeEventListener("global-click", onGlobalClick);
  }, [menuOpen]);

  function mergeStatsFromServer(partial) {
    if (!partial || typeof partial !== "object") return;
    setStats((prev) => ({
      ...prev,
      viewsCount:
        typeof partial.viewsCount === "number"
          ? partial.viewsCount
          : prev.viewsCount,
      likesCount:
        typeof partial.likesCount === "number"
          ? partial.likesCount
          : prev.likesCount,
      commentsCount:
        typeof partial.commentsCount === "number"
          ? partial.commentsCount
          : prev.commentsCount,
      sharesCount:
        typeof partial.sharesCount === "number"
          ? partial.sharesCount
          : prev.sharesCount,
      savesCount:
        typeof partial.savesCount === "number"
          ? partial.savesCount
          : prev.savesCount,
      likedByMe:
        typeof partial.likedByMe === "boolean"
          ? partial.likedByMe
          : prev.likedByMe,
      savedByMe:
        typeof partial.savedByMe === "boolean"
          ? partial.savedByMe
          : prev.savedByMe,
    }));
  }

  async function sendViewTick() {
    if (!id) return;
    const revision = ++statsRevisionRef.current;
    try {
      const statsFromServer = await recordPostView(id);
      if (revision === statsRevisionRef.current) {
        mergeStatsFromServer(statsFromServer);
      }
    } catch {
      // Counts stay server-authoritative; the next successful read repairs UI.
    }
  }

  async function toggleLike() {
    if (!me) return alert("Login to like");
    if (!id || loadingLike) return;

    setLoadingLike(true);
    const wasLiked = stats.likedByMe;

    setStats((prev) => ({
      ...prev,
      likedByMe: !wasLiked,
      likesCount: wasLiked
        ? Math.max(0, prev.likesCount - 1)
        : prev.likesCount + 1,
    }));

    try {
      const res = wasLiked
        ? await api.delete(`/api/posts/${id}/like`)
        : await api.post(`/api/posts/${id}/like`);
      mergeStatsFromServer(res?.data || {});
    } catch {
      setStats((prev) => ({
        ...prev,
        likedByMe: wasLiked,
        likesCount: wasLiked
          ? prev.likesCount + 1
          : Math.max(0, prev.likesCount - 1),
      }));
    } finally {
      setLoadingLike(false);
    }
  }

  async function toggleSave() {
    if (!me) return alert("Login to save");
    if (!id || loadingSave) return;

    setLoadingSave(true);
    const wasSaved = stats.savedByMe;

    setStats((prev) => ({
      ...prev,
      savedByMe: !wasSaved,
      savesCount: wasSaved
        ? Math.max(0, prev.savesCount - 1)
        : prev.savesCount + 1,
    }));

    try {
      const res = wasSaved
        ? await api.delete(`/api/posts/${id}/save`)
        : await api.post(`/api/posts/${id}/save`);
      mergeStatsFromServer(res?.data || {});
    } catch {
      setStats((prev) => ({
        ...prev,
        savedByMe: wasSaved,
        savesCount: wasSaved
          ? prev.savesCount + 1
          : Math.max(0, prev.savesCount - 1),
      }));
    } finally {
      setLoadingSave(false);
    }
  }

  async function handleShare() {
    if (!id) return;

    const base = window.location.origin;
    const url = `${base}/for-you/${id}`;

    try {
      const res = await api.post(`/api/posts/${id}/share`);
      mergeStatsFromServer(res?.data || {});
    } catch {
      setStats((prev) => ({ ...prev, sharesCount: prev.sharesCount + 1 }));
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: post?.pro?.name || post?.authorName || "Post",
          text: post?.text || "",
          url,
        });
        return;
      } catch {}
    }

    try {
      await navigator.clipboard.writeText(url);
      alert("Link copied. You can paste it to share.");
    } catch {
      alert("Share link: " + url);
    }
  }

  async function submitComment(e) {
    e?.preventDefault();
    if (!me) return alert("Login to comment");
    if (!id) return;

    const txt = commentText.trim();
    if (!txt) return;

    const tmpId = "tmp-" + Date.now();
    const optimistic = {
      _id: tmpId,
      postId: id,
      text: txt,
      authorName: me.displayName || me.fullName || "You",
      authorAvatar: me.photoUrl || me.photoURL || "",
      ownerUid: me.uid,
      createdAt: new Date().toISOString(),
    };

    setComments((c) => [optimistic, ...c]);
    setCommentText("");
    setStats((p) => ({ ...p, commentsCount: p.commentsCount + 1 }));

    try {
      const res = await api.post(`/api/posts/${id}/comments`, { text: txt });
      const real = res?.data?.comment;
      setComments((c) => [
        real || optimistic,
        ...c.filter((cm) => cm._id !== tmpId),
      ]);
      mergeStatsFromServer(res?.data || {});
    } catch {
      setComments((c) => c.filter((cm) => cm._id !== tmpId));
      setStats((p) => ({
        ...p,
        commentsCount: Math.max(0, p.commentsCount - 1),
      }));
    }
  }

  async function handleDeleteComment(commentId) {
    if (!commentId) return;
    if (!window.confirm("Delete this comment?")) return;

    try {
      await api.delete(`/api/comments/${commentId}`);
      setComments((c) => c.filter((cm) => cm._id !== commentId));
      setStats((p) => ({
        ...p,
        commentsCount: Math.max(0, p.commentsCount - 1),
      }));
    } catch {
      alert("Failed to delete comment");
    }
  }

  async function handleHideOrDeletePost() {
    if (!id) return;
    if (!window.confirm("Delete / hide this post?")) return;

    setDeleting(true);
    try {
      await api.delete(`/api/posts/${id}`).catch(async () => {
        await api.patch(`/api/posts/${id}/hide`);
      });
      navigate("/browse", { replace: true });
    } catch {
      alert("Failed to delete/hide post");
    } finally {
      setDeleting(false);
      setMenuOpen(false);
    }
  }

  async function onClickVideo() {
    if (Capacitor.isNativePlatform() && id) {
      const ok = await openNativeFeed({
        lga: post?.lga || post?.pro?.lga || "",
        postId: id,
        startMode: "reels",
      });
      if (ok) return;
    }

    const vid = videoRef.current;
    if (!vid) return;

    setUserHasInteracted(true);
    setShowControls(true);

    if (muted) {
      setMuted(false);
      vid.muted = false;
      setSoundEnabled(true);
    }

    if (vid.paused) {
      playTriggeredByObserverRef.current = false;
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }

  function onVideoPlay() {
    if (playTriggeredByObserverRef.current) return;
    if (!userHasInteracted) setUserHasInteracted(true);

    const now =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();

    if (!lastWatchTsRef.current) {
      lastWatchTsRef.current = now;
    }
  }

  function onToggleMute(e) {
    e.stopPropagation();
    const vid = videoRef.current;
    const next = !muted;

    setMuted(next);
    if (vid) vid.muted = next;
    setSoundEnabled(!next);

    if (!next && vid?.paused) {
      playTriggeredByObserverRef.current = false;
      vid.play().catch(() => {});
    }
  }

  function onLoadedMetadata() {
    const vid = videoRef.current;
    if (!vid) return;

    setDuration(vid.duration || 0);

    const wantSound = getSoundEnabled();
    vid.muted = !wantSound;
    setMuted(!wantSound);

    playTriggeredByObserverRef.current = true;
  }

  function onTimeUpdate() {
    const vid = videoRef.current;
    if (!vid) return;

    if (!seeking) {
      const nowUi =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();

      if (nowUi - lastTimeUpdateRef.current >= 250) {
        lastTimeUpdateRef.current = nowUi;
        setCurrentTime(vid.currentTime || 0);
      }
    }

    if (vid.paused) {
      lastWatchTsRef.current = 0;
      return;
    }

    if (playTriggeredByObserverRef.current && !userHasInteracted) return;

    const now =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();

    if (!lastWatchTsRef.current) {
      lastWatchTsRef.current = now;
      return;
    }

    const deltaSec = (now - lastWatchTsRef.current) / 1000;
    if (deltaSec <= 0) return;

    lastWatchTsRef.current = now;
    watchAccumRef.current += deltaSec;

    if (watchAccumRef.current >= 10) {
      watchAccumRef.current = 0;
      sendViewTick();
    }
  }

  function onSeekStart() {
    setSeeking(true);
  }

  function onSeekChange(v) {
    setCurrentTime(v);
  }

  function onSeekCommit(v) {
    const vid = videoRef.current;
    if (!vid) {
      setSeeking(false);
      return;
    }

    const safe = Number.isFinite(v) ? v : 0;
    vid.currentTime = safe;
    setCurrentTime(safe);
    setSeeking(false);

    const now =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();

    lastWatchTsRef.current = now;
  }

  function jump(seconds) {
    const vid = videoRef.current;
    if (!vid) return;

    const baseDuration = duration || vid.duration || 0;
    const next = Math.min(
      Math.max((vid.currentTime || 0) + seconds, 0),
      baseDuration || 0,
    );

    vid.currentTime = next;
    setCurrentTime(next);
  }

  async function toggleFullscreen() {
    const vid = videoRef.current;
    if (!vid) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
        return;
      }
      if (vid.requestFullscreen) return void vid.requestFullscreen();
      const anyVid = vid;
      if (anyVid.webkitEnterFullscreen) {
        return void anyVid.webkitEnterFullscreen();
      }
    } catch {}
  }

  async function goToProfile() {
    const postUsername =
      (post?.username && String(post.username).trim()) ||
      (post?.pro?.username && String(post.pro.username).trim()) ||
      (post?.ownerUsername && String(post.ownerUsername).trim()) ||
      null;

    if (postUsername) {
      navigate(`/profile/${encodeURIComponent(postUsername)}`);
      return;
    }

    const uid =
      post?.proOwnerUid ||
      post?.pro?.ownerUid ||
      post?.ownerUid ||
      post?.createdBy ||
      post?.uid ||
      post?.userId ||
      post?._ownerUid ||
      null;

    if (!uid) return;

    try {
      const res = await api.get(
        `/api/profile/public-by-uid/${encodeURIComponent(uid)}`,
      );
      const data = res?.data;
      if (data && data.profile && data.profile.username) {
        navigate(`/profile/${encodeURIComponent(data.profile.username)}`);
        return;
      }
    } catch {}

    navigate(`/profile/${encodeURIComponent(uid)}`);
  }

  function handleMouseEnter() {
    setShowControls(true);
  }

  function handleMouseLeave() {
    setShowControls(false);
  }

  const isOwner =
    me?.uid &&
    (post?.proOwnerUid === me.uid ||
      post?.ownerUid === me.uid ||
      post?.createdBy === me.uid);

  const pro = post?.pro || {};
  const avatar = post?.authorAvatar || pro.photoUrl || "";
  const proName = pro.name || post?.authorName || "Professional";
  const lga = pro.lga || post?.lga || "";

  if (!videoSrc) return null;

  return (
    <article
      ref={pageRef}
      className="snap-start snap-always bg-black md:flex md:items-center md:justify-center"
      style={{
        height: "100dvh",
        minHeight: "100dvh",
      }}
    >
      <div
        className="relative w-full bg-black overflow-hidden kpo-mobile-media-frame
       md:h-[86vh] md:max-h-none md:w-[420px]
       md:rounded-2xl md:overflow-hidden"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="absolute top-0 left-0 right-0 z-[4] px-3 pt-3 pb-2 flex items-start justify-end bg-gradient-to-b from-black/70 via-black/20 to-transparent">
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Open post menu"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 text-white"
              type="button"
            >
              ⋯
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-[#141414] border border-[#2a2a2a] rounded-lg shadow-lg z-30">
                {post.proId && (
                  <button
                    onClick={() => {
                      navigate(`/book/${post.proId}`);
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                    type="button"
                  >
                    Book now
                  </button>
                )}

                <button
                  onClick={() => {
                    toggleSave();
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                  type="button"
                >
                  {stats.savedByMe
                    ? "Unsave post"
                    : "Save post / Add to collection"}
                </button>

                <button
                  onClick={() => {
                    const base = window.location.origin;
                    const url = `${base}/for-you/${id}`;
                    if (navigator.clipboard?.writeText) {
                      navigator.clipboard
                        .writeText(url)
                        .then(() => alert("Link copied"))
                        .catch(() => alert("Share link: " + url));
                    } else {
                      alert("Share link: " + url);
                    }
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                  type="button"
                >
                  Copy link
                </button>

                {isOwner ? (
                  <button
                    onClick={handleHideOrDeletePost}
                    disabled={deleting}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b] text-red-300 disabled:opacity-50"
                    type="button"
                  >
                    {deleting ? "Deleting…" : "Delete / Hide Post"}
                  </button>
                ) : (
                  <div className="px-3 py-2 text-xs text-gray-500">
                    You can only hide your own post
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <video
          ref={videoRef}
          className={`absolute inset-0 w-full h-full object-cover ${
            hasFirstFrame ? "opacity-100" : "opacity-0"
          }`}
          poster={thumbSrc || undefined}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          controls={false}
          onClick={onClickVideo}
          onPlay={onVideoPlay}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          onLoadedData={() => setHasFirstFrame(true)}
          onPlaying={() => setHasFirstFrame(true)}
          onError={() => {
            setHasFirstFrame(true);
            setVideoError(
              "This video couldn't play here. Tap the video to open it.",
            );
          }}
        />

        {!hasFirstFrame && !!thumbSrc && (
          <img
            src={thumbSrc}
            alt=""
            className="absolute inset-0 w-full h-full object-cover z-[2] pointer-events-none"
            loading="lazy"
          />
        )}

        <div className="absolute left-0 right-16 bottom-0 z-[3] px-4 pb-4 pt-12 bg-gradient-to-t from-black/85 via-black/35 to-transparent pointer-events-none">
          <div className="pointer-events-auto">
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-10 h-10 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center cursor-pointer shrink-0"
                onClick={goToProfile}
                title="View profile"
                role="button"
                aria-label="View profile"
              >
                {avatar ? (
                  <img
                    src={avatar}
                    alt={proName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-sm text-white">
                    {proName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>

              <div className="min-w-0">
                <div
                  className="text-sm font-semibold text-white truncate max-w-[220px] cursor-pointer"
                  onClick={goToProfile}
                  title="View profile"
                >
                  {proName}
                </div>
                <div className="text-xs text-gray-300">
                  {lga || "Nigeria"} • {timeAgo(post.createdAt)}
                </div>
              </div>
            </div>

            {captionText ? (
              <div className="text-white text-sm leading-snug">
                <span>{captionShown}</span>
                {captionTooLong && !showFullCaption && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowFullCaption(true);
                    }}
                    className="ml-2 text-xs text-gold"
                  >
                    more…
                  </button>
                )}
                {captionTooLong && showFullCaption && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowFullCaption(false);
                    }}
                    className="ml-2 text-xs text-gold"
                  >
                    less
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="absolute right-3 bottom-4 flex flex-col items-center gap-4 z-[3]">
          <button
            type="button"
            onClick={toggleLike}
            disabled={loadingLike}
            className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center"
          >
            <span
              className={
                stats.likedByMe
                  ? "text-[#F5C542] text-lg"
                  : "text-white text-lg"
              }
            >
              ♥
            </span>
          </button>
          <div className="text-[11px] text-white">{stats.likesCount ?? 0}</div>

          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center"
          >
            <span className="text-white text-lg">💬</span>
          </button>
          <div className="text-[11px] text-white">
            {stats.commentsCount ?? 0}
          </div>

          <button
            type="button"
            onClick={toggleSave}
            disabled={loadingSave}
            className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center"
          >
            <span
              className={
                stats.savedByMe
                  ? "text-[#F5C542] text-lg"
                  : "text-white text-lg"
              }
            >
              🔖
            </span>
          </button>
          <div className="text-[11px] text-white">{stats.savesCount ?? 0}</div>

          <button
            type="button"
            onClick={handleShare}
            className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center"
          >
            <span className="text-white text-lg">↗</span>
          </button>
          <div className="text-[11px] text-white">{stats.sharesCount ?? 0}</div>

          <div className="flex flex-col items-center gap-1 mt-1">
            <div className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center">
              <span className="text-white text-base">👁</span>
            </div>
            <div className="text-[11px] text-white">
              {stats.viewsCount ?? 0}
            </div>
          </div>
        </div>

        {showControls && (
          <>
            <div className="absolute bottom-3 left-3 flex gap-2 z-[2]">
              <button
                onClick={onClickVideo}
                className="bg-black/50 text-white text-xs px-3 py-1 rounded-full"
                type="button"
              >
                {videoRef.current && !videoRef.current.paused
                  ? "Pause"
                  : "Play"}
              </button>
              <button
                onClick={onToggleMute}
                className="bg-black/50 text-white text-xs px-3 py-1 rounded-full"
                type="button"
              >
                {muted ? "Unmute" : "Mute"}
              </button>
            </div>

            <div className="absolute inset-x-0 bottom-0 z-[2] px-3 pb-3 pt-6 bg-gradient-to-t from-black/70 via-black/20 to-transparent">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => jump(-10)}
                    className="rounded-full bg-black/60 text-white text-xs px-3 py-1"
                    type="button"
                  >
                    ⏪ 10s
                  </button>
                  <button
                    onClick={() => jump(+10)}
                    className="rounded-full bg-black/60 text-white text-xs px-3 py-1"
                    type="button"
                  >
                    10s ⏩
                  </button>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-white/90">
                  <span>
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                  <button
                    onClick={toggleFullscreen}
                    className="rounded-md bg-black/60 text-white text-[11px] px-2 py-1 ml-2"
                    type="button"
                  >
                    ⛶
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(1, duration || 0)}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                onMouseDown={onSeekStart}
                onTouchStart={onSeekStart}
                onChange={(e) => onSeekChange(Number(e.target.value || 0))}
                onMouseUp={(e) => onSeekCommit(Number(e.target.value || 0))}
                onTouchEnd={(e) => onSeekCommit(Number(e.target.value || 0))}
                className="w-full accent-[#F5C542]"
              />
            </div>
          </>
        )}

        {videoError && (
          <div className="absolute inset-x-0 bottom-16 px-4">
            <div className="bg-red-600/80 text-xs text-white px-3 py-2 rounded-lg">
              {videoError}
            </div>
          </div>
        )}
      </div>

      {showComments && (
        <div className="px-4 py-3 border-t border-[#1F1F1F]">
          {!post?.commentsDisabled ? (
            <form onSubmit={submitComment} className="flex gap-2 mb-3">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={me ? "Write a comment..." : "Login to comment..."}
                className="flex-1 bg-[#121212] border border-[#2b2b2b] rounded-full px-3 py-2 text-sm text-white"
              />
              <button
                className="text-sm bg-[#F5C542] text-black rounded-full px-3 py-1"
                type="submit"
                disabled={!me}
              >
                Post
              </button>
            </form>
          ) : (
            <div className="text-xs text-red-400 mb-3">
              Comments are disabled for this post.
            </div>
          )}

          <div className="space-y-3">
            {comments.map((c) => (
              <div key={c._id} className="flex gap-2">
                <div className="w-8 h-8 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center text-xs text-white">
                  {c.authorAvatar ? (
                    <img
                      src={c.authorAvatar}
                      alt={c.authorName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    (c.authorName || "U").slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-xs text-white font-semibold">
                    {c.authorName || "User"}
                  </div>
                  <div className="bg-[#141414] rounded-2xl px-3 py-2 text-sm text-gray-200">
                    {c.text}
                  </div>
                  <div className="flex gap-3 items-center text-[10px] text-gray-500 mt-1">
                    <span>
                      {c.createdAt
                        ? new Date(c.createdAt).toLocaleString()
                        : ""}
                    </span>
                    {me?.uid && me.uid === c.ownerUid && (
                      <button
                        type="button"
                        onClick={() => handleDeleteComment(c._id)}
                        className="text-red-300 hover:text-red-100"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {comments.length === 0 && (
              <div className="text-xs text-gray-500">No comments yet.</div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
