// apps/web/src/pages/ForYou.jsx
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useMe } from "../context/MeContext.jsx";
import { Capacitor } from "@capacitor/core";
import { openNativeVideoPlayer } from "../lib/nativeVideoPlayer";
import { openNativeFeed } from "../lib/nativeFeed";
import {
  requestExclusivePlay,
  pauseIfActive,
  getSoundEnabled,
  setSoundEnabled,
} from "../lib/mediaPolicy";
import MobileBackButton from "../components/MobileBackButton.jsx";
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
  return `${days}d`;
}

function formatTime(sec = 0) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/**
 * PARENT: vertical "For You" feed
 * - Loads first post (from :id or /for-you/start)
 * - Loads the next one
 * - On scroll-near-bottom, keeps loading next posts
 */
export default function ForYou() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me } = useMe();

  const [feedPosts, setFeedPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [endOfFeed, setEndOfFeed] = useState(false);
  // sentinel used by IntersectionObserver (better than window.scroll)
  const sentinelRef = useRef(null);
  const observerRef = useRef(null);
  // Queue cursor to keep /next calls stable (fixes "only 2 videos")
  const lastCursorIdRef = useRef(null);

  // ✅ Native Android: open the real native feed screen (do not run the web feed here)
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!Capacitor.isNativePlatform()) return;

      // ✅ fail-safe: never spin forever
      const timeoutMs = 2000;
      const timeout = new Promise((resolve) =>
        setTimeout(() => resolve(false), timeoutMs),
      );

      let opened = false;
      try {
        opened = await Promise.race([openNativeFeed({ lga: "" }), timeout]);
      } catch {
        opened = false;
      }

      if (!alive) return;

      if (opened) {
        // native UI took over; stop web rendering
        setLoading(false);
        setFeedPosts([]);
        return;
      }

      // ✅ native feed did NOT open -> show an error instead of infinite loader
      setLoading(false);
      setError("Native feed failed to open. Please try again.");
    })();

    return () => {
      alive = false;
    };
  }, []);

  // initial load (first + next) — web only (Android native uses NativeFeedActivity)
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;

    let cancelled = false;

    async function loadInitial() {
      setLoading(true);
      setError("");
      setFeedPosts([]);
      setEndOfFeed(false);

      try {
        let firstPost = null;

        if (id) {
          const { data } = await api.get(`/api/posts/${id}`);
          firstPost = data || null;
        } else {
          const { data } = await api.get("/api/posts/for-you/start");
          firstPost = data?.post || data?.start || null;
        }

        if (!firstPost || !firstPost._id) {
          throw new Error("No videos available right now.");
        }

        const posts = [firstPost];

        // try to pre-fetch the very next post
        try {
          const resNext = await api.get(`/api/posts/${firstPost._id}/next`);
          const nxt = resNext?.data?.next || null;
          if (nxt && nxt._id && nxt._id !== firstPost._id) {
            posts.push(nxt);
          }
        } catch {
          // ignore – we'll still show the first post
        }

        if (!cancelled) {
          setFeedPosts(posts);
          // cursor is the last item we have
          lastCursorIdRef.current = posts[posts.length - 1]?._id || null;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Unable to load For You feed.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInitial();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // load the "next" post based on the last item in the feed
  const loadMore = useCallback(async () => {
    if (loadingMore || endOfFeed) return;
    if (!feedPosts.length) return;

    setLoadingMore(true);

    try {
      // We may get duplicates or null from /next sometimes.
      // So we attempt several hops in one "loadMore" call before giving up.
      let attempts = 0;
      let cursorId =
        lastCursorIdRef.current || feedPosts[feedPosts.length - 1]?._id;

      while (attempts < 6 && cursorId) {
        attempts += 1;

        const res = await api.get(`/api/posts/${cursorId}/next`);
        const nxt = res?.data?.next || null;

        // If server says no next, only then we end.
        if (!nxt || !nxt._id) {
          setEndOfFeed(true);
          return;
        }

        // If server repeats same id, move cursor and try again (don’t end feed)
        if (String(nxt._id) === String(cursorId)) {
          cursorId = nxt._id;
          continue;
        }

        // If duplicate of any already loaded, move cursor and try again
        const already = feedPosts.some(
          (p) => String(p._id) === String(nxt._id),
        );
        if (already) {
          cursorId = nxt._id;
          continue;
        }

        // ✅ found a new one
        setFeedPosts((prev) => [...prev, nxt]);
        lastCursorIdRef.current = nxt?._id || cursorId || null;
        return;
      }

      // If we tried multiple times and kept getting duplicates, do NOT kill the feed.
      // Just stop this attempt; next scroll may succeed.
      return;
    } catch {
      // On transient failure, do NOT kill the feed permanently.
      return;
    } finally {
      setLoadingMore(false);
    }
  }, [feedPosts, loadingMore, endOfFeed]);

  // IntersectionObserver → loadMore() when sentinel becomes visible
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    // clean up any previous observer
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
        // call loadMore when we're near the bottom
        loadMore();
      },
      {
        root: null, // viewport
        rootMargin: "1200px", // start loading earlier (before user hits bottom)
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
  }, [loadMore]);

  if (loading) return <RouteLoader full />;

  if (error) {
    return (
      <div className="max-w-xl mx-auto p-4">
        <div className="bg-[#151515] border border-[#2a2a2a] rounded-xl p-6">
          <div className="text-lg font-semibold mb-2">For You</div>
          <div className="text-sm text-gray-400">{error}</div>
          <div className="mt-4">
            <Link to="/browse" className="text-gold">
              ← Back to feed
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!feedPosts.length) {
    if (Capacitor.isNativePlatform()) {
      return (
        <div className="w-full h-[100dvh] bg-black flex items-center justify-center">
          <div className="text-sm text-gray-400">Opening For You…</div>
        </div>
      );
    }

    return (
      <div className="max-w-xl mx-auto p-4">
        <div className="bg-[#151515] border border-[#2a2a2a] rounded-xl p-6">
          <div className="text-lg font-semibold mb-2">For You</div>
          <div className="text-sm text-gray-400">
            No videos available right now.
          </div>
          <div className="mt-4">
            <Link to="/browse" className="text-gold">
              ← Back to feed
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-[100dvh] bg-black overflow-hidden">
      {/* Top bar (Back + label) - does not push layout */}
      <div className="fixed top-0 left-0 right-0 z-[50] px-3 pt-3 pb-2 bg-gradient-to-b from-black/75 via-black/40 to-transparent pointer-events-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MobileBackButton fallback="/browse" />
            <div className="text-white font-semibold">For You</div>
          </div>

          <div className="flex items-center gap-3 text-white/90">
            <button
              type="button"
              className="p-2 rounded-full hover:bg-white/10"
              aria-label="Search"
            >
              🔍
            </button>
            <button
              type="button"
              className="p-2 rounded-full hover:bg-white/10"
              aria-label="Upload"
              style={{ touchAction: "manipulation" }}
              onClick={() => navigate("/compose")}
            >
              📷
            </button>

            <button
              type="button"
              className="p-2 rounded-full hover:bg-white/10"
              aria-label="Profile"
              onClick={() => navigate("/profile")}
            >
              👤
            </button>
          </div>
        </div>
      </div>

      {/* self-contained spinner animation */}
      <style>{`
        @keyframes kpochaSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* snap container */}
      <div
        className="w-full h-[100dvh] overflow-y-auto snap-y snap-mandatory"
        style={{ WebkitOverflowScrolling: "touch" }}
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
              if (remaining <= 2) loadMore();
            }}
          />
        ))}

        <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

        {loadingMore && (
          <div className="px-4 py-3 text-[11px] text-gray-500">
            Loading more…
          </div>
        )}

        {endOfFeed && (
          <div className="px-4 py-4 text-[11px] text-gray-600 text-center">
            You&apos;ve reached the end for now.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * CHILD: single post in the For You feed
 * (all the video player + side buttons, comments, etc.)
 */
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

  // caption inside video (TikTok-like)
  const [showFullCaption, setShowFullCaption] = useState(false);
  const CAPTION_MAX = 110;

  const captionText = String(post?.text || "").trim();
  const captionTooLong = captionText.length > CAPTION_MAX;
  const captionShown =
    !showFullCaption && captionTooLong
      ? captionText.slice(0, CAPTION_MAX) + "…"
      : captionText;

  // media bits (video)
  const videoRef = useRef(null);
  const pageRef = useRef(null);
  const menuRef = useRef(null);

  const [muted, setMuted] = useState(() => !getSoundEnabled());
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);

  const lastTimeUpdateRef = useRef(0);
  const playTriggeredByObserverRef = useRef(false);
  const watchAccumRef = useRef(0);
  const lastWatchTsRef = useRef(0);
  // ---- Global: only one <video> plays at a time (flip deck) ----
  // Stored on window to survive re-renders without new files.

  const [showControls, setShowControls] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [showSpinner, setShowSpinner] = useState(true);
  // Flip rule: play ONLY when this page is snapped (nearly full-screen visible)
  useEffect(() => {
    const el = pageRef.current;
    const vid = videoRef.current;
    if (!el || !vid || !id) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries?.[0];
        const ratio = entry?.intersectionRatio || 0;

        // Active only when almost fully in view (snap page)
        const isActive = ratio >= 0.9;

        if (isActive) {
          // preload more when close to end
          try {
            onNeedMore && onNeedMore();
          } catch {}

          // apply sound preference for autoplay
          const wantSound = getSoundEnabled();
          vid.muted = !wantSound;
          setMuted(!wantSound);

          // exclusive play (only one post plays at a time)
          requestExclusivePlay(id, vid);

          // autoplay (muted unless user enabled sound)
          playTriggeredByObserverRef.current = true;
          vid.play().catch(() => {});
        } else {
          pauseIfActive(id, vid);
        }
      },
      { threshold: [0, 0.5, 0.9, 1] },
    );

    obs.observe(el);

    return () => {
      try {
        obs.disconnect();
      } catch {}
      try {
        vid.pause();
      } catch {}
    };
  }, [id, index, onNeedMore]);

  // load stats for this post
  useEffect(() => {
    if (!id) return;
    let on = true;

    (async () => {
      try {
        const res = await api.get(`/api/posts/${id}/stats`);
        if (!on) return;
        const srv = res?.data || {};
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
      } catch {
        // ignore
      }
    })();

    return () => {
      on = false;
    };
  }, [id]);

  // load comments for this post
  useEffect(() => {
    if (!id) return;
    let on = true;
    (async () => {
      try {
        const res = await api.get(`/api/posts/${id}/comments`);
        if (on) setComments(res.data || []);
      } catch {
        // ignore
      }
    })();
    return () => {
      on = false;
    };
  }, [id]);

  // reset watchers when post changes
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
    setShowSpinner(true);
  }, [id]);

  // click-outside to close menu
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
    try {
      const res = await api.post(`/api/posts/${id}/view`);
      mergeStatsFromServer(res?.data || {});
    } catch {
      setStats((prev) => ({
        ...prev,
        viewsCount: prev.viewsCount + 1,
      }));
    }
  }

  // LIKE / SAVE / SHARE
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
      } catch {
        // ignore
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      alert("Link copied. You can paste it to share.");
    } catch {
      alert("Share link: " + url);
    }
  }

  // COMMENTS
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

  // VIDEO CONTROLS
  async function onClickVideo() {
    // 1) If native platform, open native ExoPlayer
    const url = videoSrc;
    if (Capacitor.isNativePlatform() && url) {
      const wantSound = getSoundEnabled();
      const ok = await openNativeVideoPlayer({
        url,
        startMs: 0,
        muted: !wantSound,
        loop: true,
      });
      if (ok) return; // ✅ native player took over
    }

    // 2) Web fallback (desktop / browser)
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
    const next = !muted; // next === true means muted
    setMuted(next);
    if (vid) vid.muted = next;

    // persist global preference
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

    // Apply global preference, but DO NOT autoplay here.
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
      if (anyVid.webkitEnterFullscreen)
        return void anyVid.webkitEnterFullscreen();
    } catch {
      // ignore
    }
  }

  async function handleVideoError() {
    console.warn("Video failed to load in <video>, trying fallback...");

    // If native app, try opening ExoPlayer immediately (often plays what WebView can't).
    try {
      const url = videoSrc;
      if (Capacitor.isNativePlatform() && url) {
        const wantSound = getSoundEnabled();
        const ok = await openNativeVideoPlayer({
          url,
          startMs: 0,
          muted: !wantSound,
          loop: true,
        });
        if (ok) return; // ✅ native player handled it
      }
    } catch {}

    // If fallback didn't work, show a softer message
    setVideoError(
      "This video couldn't play in the embedded player. Tap the video to open it.",
    );
  }

  function handleMouseEnter() {
    setShowControls(true);
  }
  function handleMouseLeave() {
    setShowControls(false);
  }

  // ---------- derived ----------
  const isOwner =
    me?.uid &&
    (post?.proOwnerUid === me.uid ||
      post?.ownerUid === me.uid ||
      post?.createdBy === me.uid);

  const media =
    Array.isArray(post?.media) && post.media.length ? post.media[0] : null;

  const videoSrc =
    (media && (media.url || media.secure_url || media.path)) ||
    post.videoUrl ||
    "";

  const isVideo = (() => {
    if (!media) return false;
    if (media.type === "video") return true;

    const u = String(
      media.url || media.secure_url || media.path || "",
    ).toLowerCase();

    if (!u) return false;

    // treat common video URLs as video even if type is missing
    return (
      u.endsWith(".mp4") ||
      u.endsWith(".mov") ||
      u.endsWith(".webm") ||
      u.endsWith(".mkv") ||
      u.includes("/video/")
    );
  })();

  const pro = post?.pro || {};
  const avatar = pro.photoUrl || post?.authorAvatar || "";
  const proName = pro.name || post?.authorName || "Professional";
  const lga = pro.lga || post?.lga || "";

  const followTargetUid =
    post?.proOwnerUid ||
    post?.pro?.ownerUid ||
    post?.ownerUid ||
    post?.createdBy ||
    post?.uid ||
    post?.userId ||
    post?._ownerUid ||
    null;

  const postUsername =
    (post?.username && String(post.username).trim()) ||
    (post?.pro?.username && String(post.pro.username).trim()) ||
    (post?.ownerUsername && String(post.ownerUsername).trim()) ||
    null;

  async function goToProfile() {
    if (!post) return;

    if (postUsername) {
      navigate(`/profile/${encodeURIComponent(postUsername)}`);
      return;
    }

    const uid =
      followTargetUid ||
      post?.proOwnerUid ||
      post?.ownerUid ||
      post?.createdBy ||
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
    } catch {
      // ignore
    }

    navigate(`/profile/${encodeURIComponent(uid)}`);
  }

  // This lets all videos (including old / broken Cloudinary ones) show up.
  if (!videoSrc) {
    // nothing to play at all, skip it
    return null;
  }

  return (
    <article
      ref={pageRef}
      className="relative w-full h-[100dvh] snap-start snap-always bg-black overflow-hidden"
    >
      {/* VIDEO fills the whole screen */}
      <div
        className="absolute inset-0 bg-black"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <video
          ref={videoRef}
          src={videoSrc}
          className="absolute inset-0 w-full h-full object-cover z-[1]"
          muted={muted}
          loop
          playsInline
          preload="metadata"
          controls={false}
          onLoadStart={() => setShowSpinner(true)}
          onLoadedData={() => setShowSpinner(false)}
          onCanPlay={() => setShowSpinner(false)}
          onPlaying={() => setShowSpinner(false)}
          onClick={onClickVideo}
          onPlay={onVideoPlay}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          onError={handleVideoError}
        />

        {/* ✅ spinner while loading (replaces grey player look) */}
        {showSpinner && (
          <div className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none">
            <div
              className="w-10 h-10 rounded-full border-4 border-white/30 border-t-white"
              style={{ animation: "kpochaSpin 0.9s linear infinite" }}
            />
          </div>
        )}

        {/* HEADER overlays video (no layout pushing = no grey bar) */}
        <div className="absolute top-0 left-0 right-0 z-[5] px-4 pt-4 pb-2 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 via-black/30 to-transparent">
          <div className="flex gap-3">
            <div
              className="w-10 h-10 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center cursor-pointer"
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
            <div>
              <div
                className="text-sm font-semibold text-white truncate max-w-[160px] cursor-pointer"
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

          <div className="flex items-center gap-2">
            {post.proId && (
              <Link
                to={`/book/${post.proId}`}
                className="rounded-md bg-gold text-black px-3 py-1 text-sm font-semibold"
              >
                Book
              </Link>
            )}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Open post menu"
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white"
                type="button"
              >
                ⋯
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-[#141414] border border-[#2a2a2a] rounded-lg shadow-lg z-30">
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
        </div>

        {/* CAPTION (bottom-left) */}
        {captionText && (
          <div className="absolute left-0 right-16 bottom-0 z-[5] px-4 pb-4 pt-12 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
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
          </div>
        )}

        {/* SIDE ACTIONS (force pointer events + higher z-index so they click) */}
        <div className="absolute right-3 bottom-20 flex flex-col items-center gap-4 z-[20] pointer-events-auto">
          <button
            type="button"
            onClick={toggleLike}
            disabled={loadingLike}
            style={{ touchAction: "manipulation" }}
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
            onClick={() => setShowComments(true)}
            style={{ touchAction: "manipulation" }}
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
            style={{ touchAction: "manipulation" }}
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
            style={{ touchAction: "manipulation" }}
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

        {videoError && (
          <div className="absolute inset-x-0 bottom-28 px-4 z-[7]">
            <div className="bg-red-600/80 text-xs text-white px-3 py-2 rounded-lg">
              {videoError}
            </div>
          </div>
        )}
      </div>

      {/* COMMENTS as an overlay drawer (Facebook-ish, doesn’t break snap) */}
      {showComments && (
        <div className="absolute inset-0 z-[10] bg-black/70 pointer-events-auto">
          <div className="absolute inset-x-0 bottom-0 max-h-[70dvh] bg-[#101010] border-t border-[#1F1F1F] rounded-t-2xl overflow-y-auto">
            <div className="p-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Comments</div>
              <button
                type="button"
                onClick={() => setShowComments(false)}
                className="text-sm text-zinc-300"
              >
                Close
              </button>
            </div>

            {!post?.commentsDisabled ? (
              <form onSubmit={submitComment} className="flex gap-2 px-3 pb-3">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={
                    me ? "Write a comment..." : "Login to comment..."
                  }
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
              <div className="text-xs text-red-400 px-3 pb-3">
                Comments are disabled for this post.
              </div>
            )}

            <div className="px-3 pb-4 space-y-3">
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
        </div>
      )}
    </article>
  );
}
