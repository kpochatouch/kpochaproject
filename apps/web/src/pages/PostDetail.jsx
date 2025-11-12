// apps/web/src/pages/PostDetail.jsx
import { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useMe } from "../context/MeContext.jsx";

// reusable action buttons
import LikeButton from "../components/LikeButton.jsx";
import ShareButton from "../components/ShareButton.jsx";
import CommentToggle from "../components/CommentToggle.jsx";
import FollowButton from "../components/FollowButton.jsx";
import ActionButton from "../components/ActionButton.jsx";
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

export default function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me } = useMe();

  const [loading, setLoading] = useState(true);
  const [post, setPost] = useState(null);
  const [error, setError] = useState("");

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
  const [showComments, setShowComments] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingLike, setLoadingLike] = useState(false);
  const [loadingSave, setLoadingSave] = useState(false);

  // media bits
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const playTriggeredByObserverRef = useRef(false);
  const hasSentViewRef = useRef(false);

  // ---------- fetch post ----------
  useEffect(() => {
    let on = true;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const { data } = await api.get(`/api/posts/${id}`);
        if (!on) return;
        setPost(data || null);
      } catch {
        if (!on) return;
        setError("Post not found.");
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, [id]);

  // ---------- initial stats ----------
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
      } catch {}
    })();
    return () => { on = false; };
  }, [id]);

  // ---------- load comments (detail defaults open) ----------
  useEffect(() => {
    if (!id) return;
    let on = true;
    (async () => {
      try {
        const res = await api.get(`/api/posts/${id}/comments`);
        if (on) setComments(res.data || []);
      } catch {}
    })();
    return () => { on = false; };
  }, [id]);

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

  async function sendViewOnce() {
    if (hasSentViewRef.current || !id) return;
    hasSentViewRef.current = true;
    try {
      const res = await api.post(`/api/posts/${id}/view`);
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

  // ---------- actions ----------
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
    const url = `${base}/post/${id}`;

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
      } catch { /* ignore */ }
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
      setComments((c) => [real, ...c.filter((cm) => cm._id !== tmpId)]);
      mergeStatsFromServer(res?.data || {});
    } catch {
      setComments((c) => c.filter((cm) => cm._id !== tmpId));
      setStats((p) => ({ ...p, commentsCount: Math.max(0, p.commentsCount - 1) }));
    }
  }

  async function handleDeleteComment(commentId) {
    if (!commentId) return;
    if (!window.confirm("Delete this comment?")) return;
    try {
      await api.delete(`/api/comments/${commentId}`);
      setComments((c) => c.filter((cm) => cm._id !== commentId));
      setStats((p) => ({ ...p, commentsCount: Math.max(0, p.commentsCount - 1) }));
    } catch {
      alert("Failed to delete comment");
    }
  }

  async function handleHideOrDeletePost() {
    if (!id) return;
    if (!window.confirm("Delete / hide this post?")) return;
    setDeleting(true);
    try {
      await api
        .delete(`/api/posts/${id}`)
        .catch(async () => {
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

  function onClickVideo() {
    const vid = videoRef.current;
    if (!vid) return;
    setUserHasInteracted(true);
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
    // only count real user plays, not any possible auto-play
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
      playTriggeredByObserverRef.current = false;
      vid.play().catch(() => {});
    }
  }

  function onLoadedMetadata() {
    const vid = videoRef.current;
    if (!vid) return;
    setDuration(vid.duration || 0);
  }

  function onTimeUpdate() {
    if (seeking) return;
    const vid = videoRef.current;
    if (!vid) return;
    setCurrentTime(vid.currentTime || 0);
  }

  function onSeekStart() { setSeeking(true); }
  function onSeekChange(e) { setCurrentTime(Number(e.target.value || 0)); }
  function onSeekCommit(e) {
    const vid = videoRef.current;
    const v = Number(e.target.value || 0);
    if (vid) vid.currentTime = v;
    setCurrentTime(v);
    setSeeking(false);
  }

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

  async function toggleFullscreen() {
    const vid = videoRef.current;
    if (!vid) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
        return;
      }
      if (vid.requestFullscreen) return void vid.requestFullscreen();
      const anyVid = /** @type {any} */ (vid);
      if (anyVid.webkitEnterFullscreen) return void anyVid.webkitEnterFullscreen();
    } catch {}
  }

  // ---------- derived ----------
  const isOwner =
    me?.uid &&
    (post?.proOwnerUid === me.uid ||
      post?.ownerUid === me.uid ||
      post?.createdBy === me.uid);

  const media =
    Array.isArray(post?.media) && post.media.length ? post.media[0] : null;
  const isVideo = media?.type === "video";

  const pro = post?.pro || {};
  const avatar = pro.photoUrl || post?.authorAvatar || "";
  const proName = pro.name || post?.authorName || "Professional";
  const lga = pro.lga || post?.lga || "";

  const followTargetUid =
    post?.proOwnerUid ||
    post?.pro?.ownerUid ||
    post?.ownerUid ||
    post?.createdBy ||
    null;

  // ---------- UI ----------
  if (loading) return <RouteLoader full />;

  if (error || !post) {
    return (
      <div className="max-w-xl mx-auto p-4">
        <div className="bg-[#151515] border border-[#2a2a2a] rounded-xl p-6">
          <div className="text-lg font-semibold mb-2">Post</div>
          <div className="text-sm text-gray-400">{error || "Not found"}</div>
          <div className="mt-4">
            <Link to="/browse" className="text-gold">← Back to feed</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* header */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center">
            {avatar ? (
              <img src={avatar} alt={proName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm text-white">
                {proName.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <div className="text-sm font-semibold text-white">{proName}</div>
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
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-800 text-white"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-[#141414] border border-[#2a2a2a] rounded-lg shadow-lg z-30">
                {/* Save/Unsave in the menu (your preference) */}
                <button
                  onClick={() => { toggleSave(); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  {stats.savedByMe ? "Unsave post" : "Save post / Add to collection"}
                </button>

                {/* Copy link */}
                <button
                  onClick={() => {
                    const base = window.location.origin;
                    navigator.clipboard?.writeText(`${base}/post/${id}`);
                    alert("Link copied");
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Copy link
                </button>

                {/* Owner-only actions */}
                {isOwner ? (
                  <>
                    {post.commentsDisabled ? (
                      <button
                        onClick={async () => {
                          await api.patch(`/api/posts/${id}/comments/enable`);
                          setPost((p) => ({ ...p, commentsDisabled: false }));
                          setMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                      >
                        Enable comments
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          await api.patch(`/api/posts/${id}/comments/disable`);
                          setPost((p) => ({ ...p, commentsDisabled: true }));
                          setShowComments(false);
                          setMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                      >
                        Disable comments
                      </button>
                    )}
                    <button
                      onClick={handleHideOrDeletePost}
                      disabled={deleting}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b] text-red-300 disabled:opacity-50"
                    >
                      {deleting ? "Deleting…" : "Delete / Hide Post"}
                    </button>
                  </>
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

      {/* text */}
      {post.text && (
        <div className="px-4 pb-3 text-sm text-white">{post.text}</div>
      )}

      {/* media */}
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
                controls={false}
                onClick={onClickVideo}
                onPlay={onVideoPlay}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
              />
              {!userHasInteracted && (
                <button
                  onClick={onClickVideo}
                  className="absolute inset-0"
                  aria-label="Play video"
                />
              )}
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

              <div className="absolute inset-x-0 bottom-0 z-[2] px-3 pb-3 pt-6 bg-gradient-to-t from-black/70 via-black/20 to-transparent">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => jump(-10)}
                      className="rounded-full bg-black/60 text-white text-xs px-3 py-1"
                    >
                      ⏪ 10s
                    </button>
                    <button
                      onClick={() => jump(+10)}
                      className="rounded-full bg-black/60 text-white text-xs px-3 py-1"
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
                  onMouseDown={() => setSeeking(true)}
                  onTouchStart={() => setSeeking(true)}
                  onChange={onSeekChange}
                  onMouseUp={onSeekCommit}
                  onTouchEnd={onSeekCommit}
                  className="w-full accent-[#F5C542]"
                />
              </div>
            </>
          ) : (
            <img
              src={media.url}
              alt=""
              loading="lazy"
              className="absolute inset-0 w/full h/full object-cover"
            />
          )}
        </div>
      )}

      {/* counts */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-gray-400 border-t border-[#1F1F1F]">
        <div className="flex flex-wrap gap-4">
          <div>{stats.likesCount} likes</div>
          <button onClick={() => setShowComments((v) => !v)}>
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

      {/* actions */}
      <div className="relative z-[1] flex border-t border-[#1F1F1F]">
        <LikeButton active={stats.likedByMe} onClick={toggleLike} />
        <CommentToggle onClick={() => setShowComments((v) => !v)} />
        <ShareButton onClick={handleShare} />
        {!isOwner ? (
          <FollowButton targetUid={followTargetUid} proId={post?.proId || null} />
        ) : (
          <ActionButton disabled className="text-gray-500 select-none">—</ActionButton>
        )}
      </div>

      {/* comments */}
      {showComments && (
        <div className="px-4 py-3 border-t border-[#1F1F1F]">
          {!post?.commentsDisabled ? (
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

      {/* back link */}
      <div className="px-4 py-6">
        <Link to="/browse" className="text-gold">← Back to feed</Link>
      </div>
    </div>
  );
}

function formatTime(sec = 0) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
