import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import FollowButton from "./FollowButton.jsx";
import LikeButton from "./LikeButton.jsx";
import ShareButton from "./ShareButton.jsx";
import CommentToggle from "./CommentToggle.jsx";
import ActionButton from "./ActionButton.jsx";

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
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingLike, setLoadingLike] = useState(false);
  const [loadingSave, setLoadingSave] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // media / view refs
  const videoRef = useRef(null);
  const mediaObserverRef = useRef(null);
  const cardRef = useRef(null);
  const [inView, setInView] = useState(false);
  const hasSentViewRef = useRef(false);
  const playTriggeredByObserverRef = useRef(false);

  // mobile detect (works for iOS + Android)
  const isMobile =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod|Android|Mobi/i.test(navigator.userAgent);

  // video UI
  const [muted, setMuted] = useState(true);
  const [userHasInteracted, setUserHasInteracted] = useState(false);

  // ⬇️ add these right under: const [userHasInteracted, setUserHasInteracted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);

  function formatTime(sec = 0) {
    if (!isFinite(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  const media =
    Array.isArray(post.media) && post.media.length ? post.media[0] : null;
  const isVideo = media?.type === "video";

  // text clamp
  const [showFullText, setShowFullText] = useState(false);
  const MAX_TEXT = 140;

  // 1) load stats once
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const res = await api.get(`/api/posts/${postId}/stats`);
        const srv = res?.data || {};
        if (stopped) return;
        setStats((prev) => ({
          ...prev,
          viewsCount: Math.max(prev.viewsCount, srv.viewsCount ?? 0),
          likesCount: Math.max(prev.likesCount, srv.likesCount ?? 0),
          commentsCount: Math.max(prev.commentsCount, srv.commentsCount ?? 0),
          sharesCount: Math.max(prev.sharesCount, srv.sharesCount ?? 0),
          savesCount: Math.max(prev.savesCount, srv.savesCount ?? 0),
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

  // Reset internal flags when post changes
  useEffect(() => {
    hasSentViewRef.current = false;
    playTriggeredByObserverRef.current = false;
  }, [postId]);

  function mergeStatsFromServer(partial) {
    setStats((prev) => ({
      ...prev,
      viewsCount:
        partial.viewsCount != null
          ? Math.max(prev.viewsCount, partial.viewsCount)
          : prev.viewsCount,
      likesCount:
        partial.likesCount != null
          ? Math.max(prev.likesCount, partial.likesCount)
          : prev.likesCount,
      commentsCount:
        partial.commentsCount != null
          ? Math.max(prev.commentsCount, partial.commentsCount)
          : prev.commentsCount,
      sharesCount:
        partial.sharesCount != null
          ? Math.max(prev.sharesCount, partial.sharesCount)
          : prev.sharesCount,
      savesCount:
        partial.savesCount != null
          ? Math.max(prev.savesCount, partial.savesCount)
          : prev.savesCount,
      likedByMe:
        partial.likedByMe != null ? partial.likedByMe : prev.likedByMe,
      savedByMe:
        partial.savedByMe != null ? partial.savedByMe : prev.savedByMe,
    }));
  }

  // send view (safe)
  async function sendViewOnce() {
    if (hasSentViewRef.current || !postId) return;
    hasSentViewRef.current = true;
    try {
      const res = await api.post(`/api/posts/${postId}/view`);
      const srv = res?.data || {};
      setStats((prev) => ({
        ...prev,
        viewsCount:
          srv.viewsCount != null
            ? Math.max(prev.viewsCount, srv.viewsCount)
            : prev.viewsCount + 1,
      }));
    } catch {
      setStats((prev) => ({ ...prev, viewsCount: prev.viewsCount + 1 }));
    }
  }

  // 2) observe video for auto play/pause
  useEffect(() => {
    if (!isVideo || !videoRef.current) return;

    const el = videoRef.current;
    mediaObserverRef.current?.disconnect();

    const obs = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        const nowInView = entry.isIntersecting && entry.intersectionRatio >= 0.6;
        setInView(nowInView);

        if (nowInView) {
          try {
            playTriggeredByObserverRef.current = true;
            await el.play().catch(() => {});
          } catch {
            // ignore
          }
        } else {
          el.pause();
        }
      },
      { threshold: [0, 0.4, 0.6, 0.8, 1] }
    );

    obs.observe(el);
    mediaObserverRef.current = obs;

    return () => {
      obs.disconnect();
    };
  }, [postId, isVideo]);

  useEffect(() => {
    if (!isVideo && mediaObserverRef.current) {
      mediaObserverRef.current.disconnect();
      mediaObserverRef.current = null;
    }
  }, [isVideo]);

  // 3) also send view for NON-video cards (photos / text)
  useEffect(() => {
    if (!cardRef.current) return;
    if (isVideo) return; // video will send when user actually plays
    const el = cardRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          sendViewOnce();
          obs.disconnect();
        }
      },
      { threshold: [0, 0.4, 0.6, 0.8, 1] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [isVideo]);

  function onClickVideo() {
    const vid = videoRef.current;
    if (!vid) return;

    setUserHasInteracted(true);

    // first user click → unmute
    if (muted) {
      setMuted(false);
      vid.muted = false;
    }

    if (vid.paused) {
      playTriggeredByObserverRef.current = false;
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }

  function onVideoPlay() {
    // only count real user plays, not scroll-autoplay
    if (playTriggeredByObserverRef.current) return;
    sendViewOnce();
  }

  function onToggleMute(e) {
    e.stopPropagation();
    const vid = videoRef.current;
    const next = !muted;
    setMuted(next);
    if (vid) vid.muted = next;
    if (!next && vid?.paused) {
      // user asked to unmute → also play
      playTriggeredByObserverRef.current = false;
      vid.play().catch(() => {});
    }
  }

  // when metadata loads, capture duration
  function onLoadedMetadata() {
    const vid = videoRef.current;
    if (!vid) return;
    setDuration(vid.duration || 0);
  }

  // keep currentTime in sync for the slider + label
  function onTimeUpdate() {
    if (seeking) return; // don't fight the user's finger while scrubbing
    const vid = videoRef.current;
    if (!vid) return;
    setCurrentTime(vid.currentTime || 0);
  }

  // jump helpers
  function jump(seconds) {
    const vid = videoRef.current;
    if (!vid) return;
    const next = Math.min(
      Math.max((vid.currentTime || 0) + seconds, 0),
      duration || vid.duration || 0
    );
    vid.currentTime = next;
    setCurrentTime(next);
  }

  // fullscreen (desktop + mobile Safari fallback)
  async function toggleFullscreen() {
    const vid = videoRef.current;
    if (!vid) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
        return;
      }
      if (vid.requestFullscreen) return void vid.requestFullscreen();
      // iOS WebKit fallback
      const anyVid = /** @type {any} */ (vid);
      if (anyVid.webkitEnterFullscreen) return void anyVid.webkitEnterFullscreen();
    } catch {
      // ignore
    }
  }

  // seek slider handlers
  function onSeekStart() {
    setSeeking(true);
  }

  function onSeekChange(e) {
    const v = Number(e.target.value || 0);
    setCurrentTime(v);
  }

  function onSeekCommit(e) {
    const vid = videoRef.current;
    if (!vid) {
      setSeeking(false);
      return;
    }
    const v = Number(e.target.value || 0);
    vid.currentTime = v;
    setCurrentTime(v);
    setSeeking(false);
  }

  // likes
  async function toggleLike() {
    if (!currentUser) return alert("Login to like");
    if (!postId) return;
    if (loadingLike) return;
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
    const to = !showComments;
    setShowComments(to);
    if (to && comments.length === 0 && postId) {
      try {
        const res = await api.get(`/api/posts/${postId}/comments`);
        setComments(res.data || []);
      } catch {
        // ignore
      }
    }
  }

  async function submitComment(e) {
    e?.preventDefault();
    if (!currentUser) return alert("Login to comment");
    if (!postId) return;
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
      setComments((c) => [real, ...c.filter((cm) => cm._id !== tmpId)]);
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
      await api
        .delete(`/api/posts/${postId}`)
        .catch(async () => {
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
    navigator.clipboard?.writeText(url);
    alert("Link copied");
    setMenuOpen(false);
  }

  async function handleDisableComments() {
    if (!postId) return;
    try {
      await api.patch(`/api/posts/${postId}/comments/disable`);
      post.commentsDisabled = true;
      setShowComments(false);
      setMenuOpen(false);
    } catch {
      alert("Failed to disable comments");
    }
  }

  async function handleEnableComments() {
    if (!postId) return;
    try {
      await api.patch(`/api/posts/${postId}/comments/enable`);
      post.commentsDisabled = false;
      setMenuOpen(false);
    } catch {
      alert("Failed to enable comments");
    }
  }

  const pro = post.pro || {};
  const avatar = pro.photoUrl || post.authorAvatar || "";
  const proName = pro.name || post.authorName || "Professional";
  const lga = pro.lga || post.lga || "";

  // who to follow (prefer owner UID)
  const followTargetUid =
    post.proOwnerUid ||
    post.pro?.ownerUid ||
    post.ownerUid ||
    post.createdBy ||
    null;

  // Determine username present on the post (common shapes)
  const postUsername =
    (post.username && String(post.username).trim()) ||
    (post.pro && post.pro.username && String(post.pro.username).trim()) ||
    (post.ownerUsername && String(post.ownerUsername).trim()) ||
    null;

  // NAVIGATE TO PUBLIC PROFILE:
  // - Prefer direct username if present
  // - Else attempt to resolve username from UID via API (/api/profile/public-by-uid/:uid)
  // - Fallback: navigate to /profile/<uid> if resolution fails
  async function goToProfile() {
    try {
      if (postUsername) {
        navigate(`/profile/${encodeURIComponent(postUsername)}`);
        return;
      }

      const uid = followTargetUid || post.ownerUid || post.createdBy || null;
      if (!uid) {
        // nothing to do
        return;
      }

      // try to resolve username server-side
      try {
        const res = await api.get(`/api/profile/public-by-uid/${encodeURIComponent(uid)}`);
        const data = res?.data;
        if (data && data.profile && data.profile.username) {
          navigate(`/profile/${encodeURIComponent(data.profile.username)}`);
          return;
        }
      } catch (err) {
        // server resolution failed — fall back to UID
      }

      // final fallback: use UID as path segment (this will likely 404 if no public-by-uid handler exists on frontend)
      navigate(`/profile/${encodeURIComponent(uid)}`);
    } catch (e) {
      console.warn("goToProfile failed", e);
    }
  }

  // clicking text → go to post detail (you can change route)
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
    <div
      ref={cardRef}
      className="bg-[#0F0F0F] border border-[#1F1F1F] rounded-xl overflow-hidden"
    >
      {/* header */}
      <div className="flex items-start justify-between px-4 py-3 gap-3">
        <div className="flex gap-3">
          <div
            className="w-10 h-10 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center cursor-pointer"
            onClick={goToProfile}
            title="View profile"
          >
            {avatar ? (
              <img
                src={avatar}
                alt={proName}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="text-sm text-white">
                {proName.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <div
              className="text-sm font-semibold text-white truncate max-w-[120px] cursor-pointer"
              onClick={goToProfile}
              title="View profile"
            >
              {proName}
            </div>

            <div className="text-xs text-gray-400">
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
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Open post menu"
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-800 text-white"
            >
              ⋯
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-[#141414] border border-[#2a2a2a] rounded-lg shadow-lg z-30">
                <button
                  onClick={toggleSave}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  {stats.savedByMe
                    ? "Unsave post"
                    : "Save post / Add to collection"}
                </button>
                <button
                  onClick={handleCopyLink}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Copy link
                </button>
                {isOwner ? (
                  <button
                    onClick={handleHideOrDeletePost}
                    disabled={deleting}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b] text-red-300 disabled:opacity-50"
                  >
                    {deleting ? "Deleting…" : "Delete / Hide Post"}
                  </button>
                ) : (
                  <button
                    onClick={() => alert("You can only hide your own post")}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                  >
                    Hide Post
                  </button>
                )}
                {isOwner && (
                  <>
                    {post.commentsDisabled ? (
                      <button
                        onClick={handleEnableComments}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                      >
                        Enable comments
                      </button>
                    ) : (
                      <button
                        onClick={handleDisableComments}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
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

      {/* text (with “view more”) */}
      {post.text && (
        <div className="px-4 pb-3 text-sm text-white">
          <button
            onClick={goToPostDetail}
            className="text-left w-full inline-block"
          >
            {shownText}
          </button>
          {textTooLong && !showFullText && (
            <button
              onClick={() => setShowFullText(true)}
              className="ml-1 text-xs text-gold"
            >
              View more
            </button>
          )}
        </div>
      )}

      {!media && (
        <div className="w-full aspect-[4/5] bg-[#1a1a1a] animate-pulse flex items-center justify-center text-gray-600 text-xs">
          Loading media...
        </div>
      )}

      {media && (
        <div className="relative w-full bg-black overflow-hidden aspect-[4/5] sm:aspect-[4/5] lg:aspect-[3/4] xl:aspect-[1/1] max-h-[80vh]">
          {isVideo ? (
            <>
              <video
                ref={videoRef}
                src={media.url}
                className="absolute inset-0 w-full h-full object-cover"
                muted={muted}
                loop
                playsInline
                preload="metadata"
                controls={false} // custom controls only
                onClick={onClickVideo}
                onPlay={onVideoPlay}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
              />

              {!userHasInteracted && (
                <button
                  onClick={onClickVideo}
                  className="absolute inset-0 flex items-center justify-center bg-black/0"
                  aria-label="Play video"
                />
              )}

              {/* Top-left quick controls (Play/Pause, Mute) */}
              <div className="absolute bottom-3 left-3 flex gap-2 z-[2]">
                <button
                  onClick={onClickVideo}
                  className="bg-black/50 text-white text-xs px-3 py-1 rounded-full"
                >
                  {videoRef.current && !videoRef.current.paused ? "Pause" : "Play"}
                </button>
                <button
                  onClick={onToggleMute}
                  className="bg-black/50 text-white text-xs px-3 py-1 rounded-full"
                >
                  {muted ? "Unmute" : "Mute"}
                </button>
              </div>

              {/* Bottom control bar with seek + time + +/- 10s + fullscreen */}
              <div
                className="absolute inset-x-0 bottom-0 z-[2] px-3 pb-3 pt-6
                       bg-gradient-to-t from-black/70 via-black/20 to-transparent"
                // Bigger hit area at bottom for thumbs on mobile
              >
                {/* time + jump + fullscreen row */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => jump(-10)}
                      className="rounded-full bg-black/60 text-white text-xs px-3 py-1"
                      aria-label="Seek backward 10 seconds"
                    >
                      ⏪ 10s
                    </button>
                    <button
                      onClick={() => jump(+10)}
                      className="rounded-full bg-black/60 text-white text-xs px-3 py-1"
                      aria-label="Seek forward 10 seconds"
                    >
                      10s ⏩
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-white/90">
                    <span aria-label="Current time">{formatTime(currentTime)}</span>
                    <span className="opacity-70">/</span>
                    <span aria-label="Duration">{formatTime(duration)}</span>
                    <button
                      onClick={toggleFullscreen}
                      className="rounded-md bg-black/60 text-white text-[11px] px-2 py-1 ml-2"
                      aria-label="Toggle full screen"
                    >
                      ⛶
                    </button>
                  </div>
                </div>

                {/* seek slider */}
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, duration || 0)} // avoid 0 max
                  step={0.1}
                  value={Math.min(currentTime, duration || 0)}
                  onMouseDown={onSeekStart}
                  onTouchStart={onSeekStart}
                  onChange={onSeekChange}
                  onMouseUp={onSeekCommit}
                  onTouchEnd={onSeekCommit}
                  className="w-full accent-[#F5C542]"
                  aria-label="Seek"
                />
              </div>
            </>
          ) : (
            <img
              src={media.url}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
        </div>
      )}

      {/* counts row (wrap on small screens) */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-gray-400 border-t border-[#1F1F1F]">
        <div className="flex flex-wrap gap-4">
          <div>{stats.likesCount} likes</div>
          <button onClick={handleToggleComments}>
            {stats.commentsCount} comments
          </button>
          <div>{stats.sharesCount} shares</div>
        </div>
        <div className="flex items-center gap-1">
          <span role="img" aria-label="views">👁</span>
          <span>View</span>
          <span>{stats.viewsCount}</span>
        </div>
      </div>

      {/* actions (raised z to avoid overlap with popovers) */}
      <div className="relative z-[1] flex border-t border-[#1F1F1F]">
        <LikeButton active={stats.likedByMe} onClick={toggleLike} />
        <CommentToggle onClick={handleToggleComments} />
        <ShareButton onClick={handleShare} />
        {!isOwner ? (
          <FollowButton targetUid={followTargetUid} proId={post.proId || null} />
        ) : (
          <ActionButton disabled className="text-gray-500 select-none">—</ActionButton>
        )}
      </div>

      {/* comments */}
      {showComments && (
        <div className="px-4 py-3 border-t border-[#1F1F1F]">
          {!post.commentsDisabled ? (
            <form onSubmit={submitComment} className="flex gap-2 mb-3">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1 bg-[#121212] border border-[#2b2b2b] rounded-full px-3 py-2 text-sm text-white"
              />
              <button className="text-sm bg-[#F5C542] text-black rounded-full px-3 py-1">
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
                    <span>{new Date(c.createdAt).toLocaleString()}</span>
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
            ))}
            {comments.length === 0 && (
              <div className="text-xs text-gray-500">No comments yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
