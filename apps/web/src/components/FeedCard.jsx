// apps/web/src/components/FeedCard.jsx
import { useEffect, useRef, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import FollowButton from "./FollowButton.jsx";
import LikeButton from "./LikeButton.jsx";
import ShareButton from "./ShareButton.jsx";
import CommentToggle from "./CommentToggle.jsx";
import ActionButton from "./ActionButton.jsx";
import { Capacitor } from "@capacitor/core";
import { openNativeFeed } from "../lib/nativeFeed";
import { attachHlsToVideo, isHlsUrl } from "../lib/hlsAttach";
import DisplayName from "./DisplayName.jsx";

// ------------------- Feed: Only one video plays at a time -------------------
const FEED_ACTIVE_VIDEO_KEY = "__kpocha_feed_active_video_id__";
function feedRequestExclusivePlay(postId) {
  try {
    window.dispatchEvent(
      new CustomEvent("kpocha:feed:video:play", { detail: { postId } }),
    );
  } catch {}
}

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

export default function FeedCard({ post, currentUser, onDeleted }) {
  const navigate = useNavigate();
  const postId = post._id || post.id;

  const isOwner =
    currentUser?.uid &&
    (post.proOwnerUid === currentUser.uid ||
      post.ownerUid === currentUser.uid ||
      post.createdBy === currentUser.uid);

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
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingLike, setLoadingLike] = useState(false);
  const [loadingSave, setLoadingSave] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [commentsDisabled, setCommentsDisabled] = useState(
    !!post.commentsDisabled,
  );

  // media / view refs
  const videoRef = useRef(null);
  const mediaObserverRef = useRef(null);
  const cardRef = useRef(null);
  const menuRef = useRef(null);

  // HLS.js lifecycle (web only)
  const hlsCleanupRef = useRef(null);
  const hlsSrcRef = useRef("");

  const [inView, setInView] = useState(false);
  const hasSentViewRef = useRef(false); // for non-video cards only
  const videoViewTimerRef = useRef(null); // 3s in-view -> send view
  const playTriggeredByObserverRef = useRef(false);

  // watch-time tracking for videos
  const watchAccumRef = useRef(0); // seconds watched since last tick
  const lastWatchTsRef = useRef(0); // last timestamp we updated watch-time

  // mobile detect (works for iOS + Android)
  const isMobile =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod|Android|Mobi/i.test(navigator.userAgent);

  // ----- Global sound preference (persists across videos + sessions) -----
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

  // video UI
  // default to user's saved preference; if missing => sound ON (muted=false)
  const [muted, setMuted] = useState(() => {
    try {
      const v = localStorage.getItem(SOUND_KEY);

      // First time ever: default MUTED and persist it
      if (v === null) {
        localStorage.setItem(SOUND_KEY, "0"); // sound disabled
        return true; // muted=true
      }

      // soundEnabled = "1" => muted=false
      return v !== "1";
    } catch {
      return true; // safest default: muted
    }
  });

  // facebook-like tiny speaker visibility
  const [showSpeaker, setShowSpeaker] = useState(true);
  const speakerTimerRef = useRef(null);

  const [userHasInteracted, setUserHasInteracted] = useState(false);

  // ----- Lazy video src loader (data-src -> src) -----
  async function ensureVideoSrcLoaded() {
    const el = videoRef.current;
    if (!el) return;

    const ds = (el.getAttribute("data-src") || "").trim();
    if (!ds) return;

    // If this is HLS and already attached to same src, do nothing
    if (isHlsUrl(ds) && hlsSrcRef.current === ds) return;

    const attrSrc = (el.getAttribute("src") || "").trim();

    // For non-HLS, keep your old fast path
    if (!isHlsUrl(ds)) {
      // If src is already set correctly, do nothing
      if (attrSrc && attrSrc === ds) return;

      // If we previously attached HLS, clean it up
      if (hlsCleanupRef.current) {
        try {
          hlsCleanupRef.current();
        } catch {}
        hlsCleanupRef.current = null;
        hlsSrcRef.current = "";
      }

      // Set both attribute and property (WebView needs this sometimes)
      el.setAttribute("src", ds);
      el.src = ds;

      try {
        el.load();
      } catch {}

      return;
    }

    // HLS (.m3u8)
    // Always cleanup old attachment before re-attaching
    if (hlsCleanupRef.current) {
      try {
        hlsCleanupRef.current();
      } catch {}
      hlsCleanupRef.current = null;
      hlsSrcRef.current = "";
    }

    // Clear existing src to avoid mixed states
    try {
      el.removeAttribute("src");
    } catch {}
    try {
      el.src = "";
    } catch {}

    // Attach HLS (native or hls.js)
    const cleanup = await attachHlsToVideo(el, ds);
    hlsCleanupRef.current = cleanup;
    hlsSrcRef.current = ds;
  }

  function showSpeakerBrief(ms = 2500) {
    // When muted, DO NOT auto-hide — user needs the control
    if (muted) {
      setShowSpeaker(true);
      return;
    }

    setShowSpeaker(true);
    if (speakerTimerRef.current) clearTimeout(speakerTimerRef.current);
    speakerTimerRef.current = setTimeout(() => setShowSpeaker(false), ms);
  }

  async function autoplayTrySoundThenFallbackMuted(v) {
    const soundEnabled = getSoundEnabled(); // true => user wants sound

    // 1) Try user preference first
    v.muted = !soundEnabled;
    setMuted(!soundEnabled);

    try {
      await v.play();
      // If user wants sound, show icon briefly; if muted, keep visible
      showSpeakerBrief(soundEnabled ? 1200 : 999999);
      return true;
    } catch (e1) {
      // 2) Fallback to muted autoplay (most permissive)
      try {
        v.muted = true;
        setMuted(true);
        await v.play();
        showSpeakerBrief(999999); // keep icon visible so user can unmute
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  function syncFeedMediaSession() {
    const v = videoRef.current;
    if (!v) return;

    try {
      if (!("mediaSession" in navigator)) return;

      const title =
        (post?.text && post.text.trim().slice(0, 60)) ||
        post?.pro?.name ||
        post?.authorName ||
        "Kpocha Touch";

      const artist = post?.pro?.name || post?.authorName || "Kpocha Touch";
      const artworkUrl =
        media?.thumbnailUrl || post?.pro?.photoUrl || post?.authorAvatar || "";

      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album: "Kpocha Touch",
        artwork: artworkUrl
          ? [
              { src: artworkUrl, sizes: "96x96", type: "image/png" },
              { src: artworkUrl, sizes: "192x192", type: "image/png" },
              { src: artworkUrl, sizes: "512x512", type: "image/png" },
            ]
          : [],
      });

      navigator.mediaSession.setActionHandler("play", () => {
        v.play().catch(() => {});
      });

      navigator.mediaSession.setActionHandler("pause", () => {
        v.pause();
      });

      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    } catch {}
  }

  const canComment = useMemo(
    () => !commentsDisabled && !!currentUser,
    [commentsDisabled, currentUser],
  );

  const media =
    Array.isArray(post.media) && post.media.length ? post.media[0] : null;
  const isVideo = media?.type === "video";

  // text clamp
  const [showFullText, setShowFullText] = useState(false);
  const isLightTheme =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";

  const MAX_TEXT = 140;

  // 1) load stats once (trust backend – no Math.max fights)
  useEffect(() => {
    let stopped = false;
    (async () => {
      if (!postId) return;
      try {
        const res = await api.get(`/api/posts/${postId}/stats`);
        if (stopped) return;
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
      stopped = true;
    };
  }, [postId]);

  // click-outside for menu (using "global-click" custom event)
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

  useEffect(() => {
    if (!commentsOpen) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prev;
    };
  }, [commentsOpen]);

  // Reset internal flags when post changes
  useEffect(() => {
    hasSentViewRef.current = false;
    playTriggeredByObserverRef.current = false;
    setHasFirstFrame(false);
    if (videoViewTimerRef.current) {
      clearTimeout(videoViewTimerRef.current);
      videoViewTimerRef.current = null;
    }
    watchAccumRef.current = 0;
    lastWatchTsRef.current = 0;

    // cleanup HLS instance when switching posts
    if (hlsCleanupRef.current) {
      try {
        hlsCleanupRef.current();
      } catch {}
      hlsCleanupRef.current = null;
      hlsSrcRef.current = "";
    }
  }, [postId]);

  useEffect(() => {
    return () => {
      if (speakerTimerRef.current) {
        clearTimeout(speakerTimerRef.current);
        speakerTimerRef.current = null;
      }

      if (videoViewTimerRef.current) {
        clearTimeout(videoViewTimerRef.current);
        videoViewTimerRef.current = null;
      }

      if (mediaObserverRef.current) {
        try {
          mediaObserverRef.current.disconnect();
        } catch {}
        mediaObserverRef.current = null;
      }

      if (hlsCleanupRef.current) {
        try {
          hlsCleanupRef.current();
        } catch {}
        hlsCleanupRef.current = null;
        hlsSrcRef.current = "";
      }

      const v = videoRef.current;
      if (v) {
        try {
          v.pause();
        } catch {}

        try {
          v.removeAttribute("src");
        } catch {}

        try {
          v.src = "";
        } catch {}

        try {
          v.srcObject = null;
        } catch {}

        try {
          v.load();
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

  // send one "view tick" to backend
  async function sendViewTick() {
    if (!postId) return;
    try {
      const res = await api.post(`/api/posts/${postId}/view`);
      mergeStatsFromServer(res?.data || {});
    } catch {
      // fallback: optimistic increment
      setStats((prev) => ({
        ...prev,
        viewsCount: prev.viewsCount + 1,
      }));
    }
  }

  // for NON-video cards (photos / text) – single view when card is in view
  async function sendNonVideoViewOnce() {
    if (hasSentViewRef.current || !postId) return;
    hasSentViewRef.current = true;
    await sendViewTick();
  }

  // 2) feed-wide exclusive play: if another video starts, pause this one
  useEffect(() => {
    function onOtherWantsToPlay(e) {
      const otherId = e?.detail?.postId;
      if (!otherId || !postId) return;

      if (otherId !== postId) {
        const v = videoRef.current;
        if (v && !v.paused) v.pause();
      } else {
      }
    }

    window.addEventListener("kpocha:feed:video:play", onOtherWantsToPlay);
    return () =>
      window.removeEventListener("kpocha:feed:video:play", onOtherWantsToPlay);
  }, [postId]);

  // 3) observe CARD (not video) for stable autoplay/pause + stop offscreen audio
  useEffect(() => {
    if (!isVideo) return;
    if (!cardRef.current) return;

    const cardEl = cardRef.current;

    mediaObserverRef.current?.disconnect();
    mediaObserverRef.current = null;

    const obs = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        const nowInView =
          entry.isIntersecting && entry.intersectionRatio >= 0.6;

        setInView(nowInView);

        const v = videoRef.current;
        if (!v) return;

        if (nowInView) {
          // Request exclusive play (pauses other cards)
          feedRequestExclusivePlay(postId);

          // Start a 3s "in-view" timer: if still in view, count 1 view
          if (!videoViewTimerRef.current) {
            videoViewTimerRef.current = setTimeout(() => {
              videoViewTimerRef.current = null;
              if (videoRef.current && !videoRef.current.paused) {
                sendViewTick();
              }
            }, 3000);
          }

          // Ensure src is loaded
          await ensureVideoSrcLoaded();

          // mark as autoplay-triggered (so 10s engagement won't count until interaction)
          playTriggeredByObserverRef.current = true;

          // Try sound autoplay first; fallback to muted autoplay if blocked
          const played = await autoplayTrySoundThenFallbackMuted(v);
          if (played) syncFeedMediaSession();
        } else {
          // Pause when leaving view
          // Leaving view -> cancel the 3s timer
          if (videoViewTimerRef.current) {
            clearTimeout(videoViewTimerRef.current);
            videoViewTimerRef.current = null;
          }
          v.pause();

          try {
            if (navigator.mediaSession?.metadata) {
              navigator.mediaSession.metadata = null;
            }
          } catch {}
        }
      },
      { threshold: [0, 0.25, 0.6, 1] },
    );

    obs.observe(cardEl);
    mediaObserverRef.current = obs;

    return () => {
      obs.disconnect();
      mediaObserverRef.current = null;
    };
  }, [postId, isVideo]);

  // 3) also send view for NON-video cards (photos / text)
  useEffect(() => {
    if (!cardRef.current) return;
    if (isVideo) return; // video uses watch-time logic
    const el = cardRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          sendNonVideoViewOnce();
          obs.disconnect();
        }
      },
      { threshold: [0, 0.4, 0.6, 0.8, 1] },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [isVideo]);

  async function onClickMedia() {
    if (!postId) return;

    console.log("[FeedCard] tap media", {
      native: Capacitor.isNativePlatform(),
      isVideo: !!isVideo,
      url: media?.url,
    });

    // Mark as intentional user action (stops autoplay gating)
    setUserHasInteracted(true);
    playTriggeredByObserverRef.current = false;

    // ✅ FACEBOOK-STYLE ANDROID RULE:
    // Tapping ANY media opens the mixed NativeFeedActivity.
    if (Capacitor.isNativePlatform()) {
      const okFeed = await openNativeFeed({
        lga: post?.lga || post?.pro?.lga || "",
        postId,
        startMode: "feed",
      });

      if (okFeed) return;

      // User-safe fallback: open the normal post page instead of showing a dev message
      navigate(`/post/${encodeURIComponent(postId)}`);
      return;
    }

    // ✅ WEB/DESKTOP fallback
    navigate(`/post/${encodeURIComponent(postId)}`);
  }

  function onVideoPlay() {
    // We no longer send a one-time view here.
    // Watch-time is counted in onTimeUpdate, but:
    // - We only accumulate after user interaction OR non-autoplay plays.
    if (playTriggeredByObserverRef.current) {
      // autoplay from scroll; we'll wait until user interacts
      return;
    }

    // If play was triggered by keyboard / OS controls (not click),
    // treat as user interaction so watch-time can start.
    if (!userHasInteracted) {
      setUserHasInteracted(true);
    }

    // Initialize watch-time timestamp if not set
    if (!lastWatchTsRef.current) {
      lastWatchTsRef.current =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
    }
  }

  // when metadata loads, capture duration
  function onLoadedMetadata() {
    // FeedCard doesn't need duration/seek UI.
    // Keep this hook in case you later want metadata-based logic.
  }

  function onTimeUpdate() {
    const vid = videoRef.current;
    if (!vid) return;

    // If paused, reset watch clock so resume doesn't create a giant delta
    if (vid.paused) {
      lastWatchTsRef.current = 0;
      return;
    }

    // Accumulate watch-time ONLY when:
    // - video is in view
    // - playing (not paused)
    // - and NOT a pure autoplay (user has interacted or observer flag cleared)
    if (!inView || vid.paused) return;
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

    // Every ~10s of real watch time → send a view tick
    if (watchAccumRef.current >= 10) {
      watchAccumRef.current = 0;
      sendViewTick();
    }
  }

  // likes
  async function toggleLike() {
    if (!currentUser) return alert("Login to like");
    if (!postId) return;
    if (loadingLike) return;
    setLoadingLike(true);

    const wasLiked = stats.likedByMe;

    // optimistic UI
    setStats((prev) => ({
      ...prev,
      likedByMe: !wasLiked,
      likesCount: wasLiked
        ? Math.max(0, prev.likesCount - 1)
        : prev.likesCount + 1,
    }));

    try {
      const res = wasLiked
        ? await api.delete(`/api/posts/${postId}/like`)
        : await api.post(`/api/posts/${postId}/like`);
      mergeStatsFromServer(res?.data || {});
    } catch {
      // revert
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
    if (!currentUser) return alert("Login to save");
    if (!postId) return;
    if (loadingSave) return;
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
        ? await api.delete(`/api/posts/${postId}/save`)
        : await api.post(`/api/posts/${postId}/save`);
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
    if (!postId) return;
    const base = window.location.origin;
    const url = `${base}/browse?post=${postId}`;

    try {
      const res = await api.post(`/api/posts/${postId}/share`);
      mergeStatsFromServer(res?.data || {});
    } catch {
      setStats((prev) => ({ ...prev, sharesCount: prev.sharesCount + 1 }));
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: post.pro?.name || post.authorName || "Post",
          text: post.text || "",
          url,
        });
        return;
      } catch {
        // fall through
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      alert("Link copied. You can paste it to share.");
    } catch {
      alert("Share link: " + url);
    }
  }

  async function handleToggleComments() {
    setCommentsOpen(true);

    if (comments.length === 0 && postId) {
      try {
        const res = await api.get(`/api/posts/${postId}/comments`);
        setComments(Array.isArray(res.data) ? res.data : []);
      } catch {
        setComments([]);
      }
    }
  }

  async function submitComment(e) {
    e?.preventDefault();
    if (!currentUser) return alert("Login to comment");
    if (!postId) return;
    if (!canComment) return;
    const txt = commentText.trim();
    if (!txt) return;

    const tmpId = "tmp-" + Date.now();
    const optimistic = {
      _id: tmpId,
      postId,
      text: txt,
      authorName: currentUser.displayName || currentUser.fullName || "You",
      authorAvatar: currentUser.photoUrl || currentUser.photoURL || "",
      ownerUid: currentUser.uid,
      createdAt: new Date().toISOString(),
    };

    setComments((c) => [optimistic, ...c]);
    setCommentText("");
    setStats((prev) => ({ ...prev, commentsCount: prev.commentsCount + 1 }));

    try {
      const res = await api.post(`/api/posts/${postId}/comments`, {
        text: txt,
      });
      const real = res?.data?.comment;
      setComments((c) => [
        real || optimistic,
        ...c.filter((cm) => cm._id !== tmpId),
      ]);
      mergeStatsFromServer(res?.data || {});
    } catch {
      setComments((c) => c.filter((cm) => cm._id !== tmpId));
      setStats((prev) => ({
        ...prev,
        commentsCount: Math.max(0, prev.commentsCount - 1),
      }));
    }
  }

  async function handleDeleteComment(commentId) {
    if (!commentId) return;
    if (!window.confirm("Delete this comment?")) return;
    try {
      await api.delete(`/api/comments/${commentId}`);
      setComments((c) => c.filter((cm) => cm._id !== commentId));
      setStats((prev) => ({
        ...prev,
        commentsCount: Math.max(0, prev.commentsCount - 1),
      }));
    } catch {
      alert("Failed to delete comment");
    }
  }

  async function handleHideOrDeletePost() {
    if (!postId) return;
    if (!window.confirm("Delete / hide this post?")) return;
    setDeleting(true);
    try {
      await api.delete(`/api/posts/${postId}`).catch(async () => {
        await api.patch(`/api/posts/${postId}/hide`);
      });
      onDeleted?.(postId);
    } catch {
      alert("Failed to delete/hide post");
    } finally {
      setDeleting(false);
      setMenuOpen(false);
    }
  }

  function handleCopyLink() {
    if (!postId) return;
    const base = window.location.origin;
    const url = `${base}/browse?post=${postId}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => alert("Link copied"))
        .catch(() => alert("Share link: " + url));
    } else {
      alert("Share link: " + url);
    }
    setMenuOpen(false);
  }

  async function handleDisableComments() {
    if (!postId) return;
    try {
      await api.patch(`/api/posts/${postId}/comments/disable`);
      setCommentsDisabled(true);
      setCommentsOpen(false);
      setMenuOpen(false);
    } catch {
      alert("Failed to disable comments");
    }
  }

  async function handleEnableComments() {
    if (!postId) return;
    try {
      await api.patch(`/api/posts/${postId}/comments/enable`);
      setCommentsDisabled(false);
      setMenuOpen(false);
    } catch {
      alert("Failed to enable comments");
    }
  }

  const pro = post.pro || {};
  const avatar = pro.photoUrl || post.authorAvatar || "";
  const proName = pro.name || post.authorName || "Professional";
  const proVerified = Boolean(
    pro.verified || post.verified || post.authorVerified || post.ownerVerified,
  );
  const lga = pro.lga || post.lga || "";

  // who to follow (prefer owner UID) — robust fallbacks for mixed payloads
  const followTargetUid =
    post.proOwnerUid ||
    post.pro?.ownerUid ||
    post.ownerUid ||
    post.createdBy ||
    post.uid ||
    post.userId ||
    post._ownerUid ||
    null;

  // Determine username present on the post (common shapes)
  const postUsername =
    (post.username && String(post.username).trim()) ||
    (post.pro && post.pro.username && String(post.pro.username).trim()) ||
    (post.ownerUsername && String(post.ownerUsername).trim()) ||
    null;

  // Navigate to public profile
  async function goToProfile() {
    try {
      if (postUsername) {
        navigate(`/profile/${encodeURIComponent(postUsername)}`);
        return;
      }

      const uid = followTargetUid || post.ownerUid || post.createdBy || null;
      if (!uid) {
        return;
      }

      // try to resolve username server-side
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
        // server resolution failed — fall back to UID
      }

      navigate(`/profile/${encodeURIComponent(uid)}`);
    } catch (e) {
      console.warn("goToProfile failed", e);
    }
  }

  // clicking text → go to post detail
  function goToPostDetail() {
    if (!postId) return;
    navigate(`/post/${postId}`);
  }

  const textTooLong = post.text && post.text.length > MAX_TEXT;
  const shownText =
    post.text && !showFullText
      ? post.text.slice(0, MAX_TEXT) + (textTooLong ? "..." : "")
      : post.text;

  return (
    <>
      <div
        ref={cardRef}
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border)",
          color: "var(--app-text)",
          boxShadow: isLightTheme
            ? "0 10px 30px rgba(15, 23, 42, 0.10), 0 2px 10px rgba(15, 23, 42, 0.06)"
            : "none",
        }}
      >
        {(post.text || post.proId) && (
          <div className="px-4 sm:px-5 pt-4 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {post.text ? (
                  <>
                    <button
                      onClick={goToPostDetail}
                      className="text-left w-full text-[16px] leading-7"
                      style={{ color: "var(--app-text)" }}
                      type="button"
                    >
                      {shownText}
                    </button>
                    {textTooLong && !showFullText && (
                      <button
                        onClick={() => setShowFullText(true)}
                        className="mt-2 block text-[14px] font-medium text-gold"
                        type="button"
                      >
                        View more
                      </button>
                    )}
                  </>
                ) : null}
              </div>

              <div className="shrink-0 flex items-center gap-2">
                {post.proId && (
                  <Link
                    to={`/book/${post.proId}`}
                    className="rounded-lg bg-gold text-black px-4 py-2 text-[15px] font-semibold"
                  >
                    Book
                  </Link>
                )}

                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label="Open post menu"
                    className="w-9 h-9 flex items-center justify-center rounded-full text-[22px] leading-none"
                    style={{
                      color: isLightTheme ? "#111827" : "#D4AF37",
                    }}
                    type="button"
                  >
                    ⋮
                  </button>

                  {menuOpen && (
                    <div
                      className="absolute right-0 mt-2 w-56 rounded-lg shadow-lg z-30"
                      style={{
                        backgroundColor: "var(--app-surface)",
                        border: "1px solid var(--app-border)",
                        color: "var(--app-text)",
                      }}
                    >
                      <button
                        onClick={toggleSave}
                        className="w-full text-left px-3 py-2 text-sm"
                        style={{
                          backgroundColor: "transparent",
                          color: "var(--app-text)",
                        }}
                        type="button"
                      >
                        {stats.savedByMe
                          ? "Unsave post"
                          : "Save post / Add to collection"}
                      </button>

                      <button
                        onClick={handleCopyLink}
                        className="w-full text-left px-3 py-2 text-sm"
                        style={{
                          backgroundColor: "transparent",
                          color: "var(--app-text)",
                        }}
                        type="button"
                      >
                        Copy link
                      </button>

                      {isOwner ? (
                        <button
                          onClick={handleHideOrDeletePost}
                          disabled={deleting}
                          className="w-full text-left px-3 py-2 text-sm text-red-300 disabled:opacity-50"
                          type="button"
                        >
                          {deleting ? "Deleting…" : "Delete / Hide Post"}
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            alert("You can only hide your own post")
                          }
                          className="w-full text-left px-3 py-2 text-sm"
                          style={{
                            backgroundColor: "transparent",
                            color: "var(--app-text)",
                          }}
                          type="button"
                        >
                          Hide Post
                        </button>
                      )}

                      {isOwner && (
                        <>
                          {commentsDisabled ? (
                            <button
                              onClick={handleEnableComments}
                              className="w-full text-left px-3 py-2 text-sm"
                              style={{
                                backgroundColor: "transparent",
                                color: "var(--app-text)",
                              }}
                              type="button"
                            >
                              Enable comments
                            </button>
                          ) : (
                            <button
                              onClick={handleDisableComments}
                              className="w-full text-left px-3 py-2 text-sm"
                              style={{
                                backgroundColor: "transparent",
                                color: "var(--app-text)",
                              }}
                              type="button"
                            >
                              Disable comments
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* media */}
        {media && (
          <div className="relative z-0 isolate w-full bg-black overflow-hidden aspect-[4/5] sm:aspect-[4/5] lg:aspect-[3/4] xl:aspect-[1/1] max-h-[80vh]">
            {/* ✅ Banner overlay (top) */}
            <div className="absolute inset-x-0 top-0 z-[40] pointer-events-none">
              {/* fade so text is readable */}
              <div className="px-4 pt-4 pb-10 bg-gradient-to-b from-black/75 via-black/25 to-transparent">
                <div className="flex items-center justify-between gap-2">
                  {/* left: author + time */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      goToProfile();
                    }}
                    className="pointer-events-auto flex items-center gap-2"
                    aria-label="View profile"
                    title="View profile"
                  >
                    <div className="w-10 h-10 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={proName}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-xs text-white">
                          {proName.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-white truncate max-w-[260px]">
                        <DisplayName
                          name={proName}
                          verified={proVerified}
                          badgeClassName="w-4 h-4"
                        />
                      </div>
                      <div className="text-[10px] text-gray-300">
                        {lga || "Nigeria"} • {timeAgo(post.createdAt)}
                      </div>
                    </div>
                  </button>

                  {/* right: open post */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      goToPostDetail();
                    }}
                    className="pointer-events-auto text-[13px] font-medium text-white/90 bg-black/35 hover:bg-black/50 rounded-full px-4 py-1.5"
                  >
                    View post
                  </button>
                </div>
              </div>
            </div>

            {isVideo ? (
              <>
                <video
                  ref={videoRef}
                  data-src={media.url}
                  className={`absolute inset-0 w-full h-full object-cover z-[1] ${
                    hasFirstFrame ? "opacity-100" : "opacity-0"
                  }`}
                  poster={
                    Capacitor.isNativePlatform()
                      ? undefined
                      : media?.thumbnailUrl
                  }
                  muted={muted}
                  loop
                  playsInline
                  preload="metadata"
                  controls={false}
                  onClick={onClickMedia}
                  onPlay={onVideoPlay}
                  onLoadedMetadata={onLoadedMetadata}
                  onTimeUpdate={onTimeUpdate}
                  onLoadedData={() => setHasFirstFrame(true)}
                  onPlaying={() => setHasFirstFrame(true)}
                  onError={() => setHasFirstFrame(true)}
                />

                {!hasFirstFrame && !!media?.thumbnailUrl && (
                  <img
                    src={media.thumbnailUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover z-[2] pointer-events-none"
                    loading="lazy"
                  />
                )}

                {/* ✅ Speaker icon OVER the video (inside the same relative container) */}
                {(showSpeaker || muted) && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();

                      const vid = videoRef.current;
                      if (!vid) return;

                      const nextMuted = !muted;
                      setMuted(nextMuted);
                      vid.muted = nextMuted;
                      setSoundEnabled(!nextMuted);

                      if (!nextMuted && vid.paused) {
                        playTriggeredByObserverRef.current = false;
                        vid.play().catch(() => {});
                      }

                      showSpeakerBrief(1200);
                    }}
                    aria-label={muted ? "Unmute" : "Mute"}
                    className="absolute bottom-3 right-3 z-[50] w-9 h-9 rounded-full bg-black/35 flex items-center justify-center pointer-events-auto transform-gpu"
                  >
                    <span className="text-white text-[16px] leading-none">
                      {muted ? "🔇" : "🔊"}
                    </span>
                  </button>
                )}
              </>
            ) : (
              <img
                src={media.url}
                alt=""
                loading="lazy"
                onClick={onClickMedia}
                className="absolute inset-0 w-full h-full object-cover cursor-pointer"
              />
            )}
          </div>
        )}

        {/* counts row */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3 text-[14px] border-t"
          style={{
            color: "var(--app-text-soft)",
            borderColor: "var(--app-border)",
          }}
        >
          <div className="flex flex-wrap gap-5">
            <div>{stats.likesCount} likes</div>
            <button onClick={handleToggleComments} type="button">
              {stats.commentsCount} comments
            </button>
            <div>{stats.sharesCount} shares</div>
          </div>
          <div className="flex items-center gap-1">
            <span role="img" aria-label="views">
              👁
            </span>
            <span>Views</span>
            <span>{stats.viewsCount}</span>
          </div>
        </div>

        {/* actions */}
        <div
          className="relative z-[1] flex border-t"
          style={{
            borderColor: "var(--app-border)",
            backgroundColor: "var(--app-surface)",
          }}
        >
          <LikeButton active={stats.likedByMe} onClick={toggleLike} />
          <CommentToggle onClick={handleToggleComments} />
          <ShareButton onClick={handleShare} />
          {!isOwner ? (
            <FollowButton
              targetUid={followTargetUid}
              proId={post.proId || null}
            />
          ) : (
            <ActionButton disabled className="text-gray-500 select-none">
              —
            </ActionButton>
          )}
        </div>
      </div>

      {commentsOpen && (
        <div
          className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-3 sm:p-4"
          onClick={() => setCommentsOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[88vh] rounded-2xl overflow-hidden shadow-2xl"
            style={{
              backgroundColor: "var(--app-surface)",
              border: "1px solid var(--app-border)",
              color: "var(--app-text)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-4 sm:px-5 py-4 border-b flex items-center justify-between"
              style={{ borderColor: "var(--app-border)" }}
            >
              <div className="min-w-0">
                <div className="text-[18px] font-semibold">Comments</div>
                <div
                  className="text-[13px] mt-1"
                  style={{ color: "var(--app-text-soft)" }}
                >
                  {stats.commentsCount} comments
                </div>
              </div>

              <button
                type="button"
                onClick={() => setCommentsOpen(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center text-[22px]"
                style={{
                  backgroundColor: "var(--app-surface-2)",
                  color: "var(--app-text)",
                }}
                aria-label="Close comments"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto max-h-[58vh] px-4 sm:px-5 py-4 space-y-4">
              {comments.length ? (
                comments.map((c) => (
                  <div key={c._id} className="flex gap-3 items-start">
                    <div className="w-10 h-10 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center text-xs text-white shrink-0">
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

                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold">
                        {c.authorName || "User"}
                      </div>

                      <div
                        className="mt-1 rounded-2xl px-4 py-3 text-[15px] leading-6"
                        style={{
                          backgroundColor: "var(--app-surface-2)",
                          color: "var(--app-text)",
                        }}
                      >
                        {c.text}
                      </div>

                      <div
                        className="flex gap-3 items-center text-[12px] mt-2"
                        style={{ color: "var(--app-text-soft)" }}
                      >
                        <span>
                          {c.createdAt
                            ? new Date(c.createdAt).toLocaleString()
                            : ""}
                        </span>

                        {currentUser?.uid && currentUser.uid === c.ownerUid && (
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
                ))
              ) : (
                <div
                  className="text-sm"
                  style={{ color: "var(--app-text-soft)" }}
                >
                  No comments yet.
                </div>
              )}
            </div>

            <div
              className="px-4 sm:px-5 py-4 border-t"
              style={{ borderColor: "var(--app-border)" }}
            >
              {!commentsDisabled ? (
                <form onSubmit={submitComment} className="flex gap-2">
                  <input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder={
                      currentUser ? "Write a comment..." : "Login to comment..."
                    }
                    className="flex-1 rounded-full px-4 py-3 text-[15px]"
                    style={{
                      backgroundColor: "var(--app-surface-2)",
                      border: "1px solid var(--app-border)",
                      color: "var(--app-text)",
                    }}
                    disabled={!currentUser}
                  />

                  <button
                    className="text-[15px] font-medium bg-[#F5C542] text-black rounded-full px-5 py-2"
                    type="submit"
                    disabled={!currentUser}
                  >
                    Post
                  </button>
                </form>
              ) : (
                <div className="text-sm text-red-400">
                  Comments are disabled for this post.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
