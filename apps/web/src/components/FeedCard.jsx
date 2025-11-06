// apps/web/src/components/FeedCard.jsx
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

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

  // ---- VIDEO AUTOPLAY CONTROL (on-screen & hover) ----
  const videoRef = useRef(null);
  const observerRef = useRef(null);
  const [inView, setInView] = useState(false);

  // view counting control
  const hasSentViewRef = useRef(false);
  const playTriggeredByObserverRef = useRef(false);

  const media =
    Array.isArray(post.media) && post.media.length ? post.media[0] : null;
  const isVideo = media?.type === "video";

  useEffect(() => {
    let stopped = false;

    // load stats
    (async () => {
      try {
        const res = await api.get(`/api/posts/${postId}/stats`);
        if (!stopped) setStats((s) => ({ ...s, ...res.data }));
      } catch {}
    })();

    return () => {
      stopped = true;
    };
  }, [postId]);

  // helper: send view once
  async function sendViewOnce() {
    if (hasSentViewRef.current || !postId) return;
    hasSentViewRef.current = true;
    try {
      const res = await api.post(`/api/posts/${postId}/view`);
      setStats((s) => ({
        ...s,
        viewsCount: res?.data?.viewsCount ?? s.viewsCount + 1,
      }));
    } catch {
      // if it fails, don't spam; we already marked it sent
    }
  }

  // Intersection observer: ONLY play/pause, NO view counting here
  useEffect(() => {
    if (!isVideo || !videoRef.current) return;

    const el = videoRef.current;
    observerRef.current?.disconnect();

    observerRef.current = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        const nowInView =
          entry.isIntersecting && entry.intersectionRatio >= 0.6;
        setInView(nowInView);

        try {
          if (nowInView) {
            // this play was triggered by scroll, we don't count view here
            playTriggeredByObserverRef.current = true;
            await el.play().catch(() => {});
          } else {
            el.pause();
          }
        } catch {}
      },
      { threshold: [0, 0.25, 0.6, 0.75, 1] }
    );

    observerRef.current.observe(el);
    return () => observerRef.current?.disconnect();
  }, [postId, isVideo]);

  // Desktop hover: just play, no counting
  function onMouseEnterVideo() {
    if (!videoRef.current) return;
    videoRef.current.play().catch(() => {});
  }
  function onMouseLeaveVideo() {
    if (!videoRef.current) return;
    if (!inView) videoRef.current.pause();
  }

  // Click = user intent → play/pause + count view if first time
  function onClickVideo() {
    if (!videoRef.current) return;
    const vid = videoRef.current;
    if (vid.paused) {
      // mark that this is user-triggered, so onPlay will count
      playTriggeredByObserverRef.current = false;
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }

  // when the video actually starts playing
  function onVideoPlay() {
    // if it was auto-played by scroll, we skip counting here
    if (playTriggeredByObserverRef.current) return;
    // user-triggered play → count view once
    sendViewOnce();
  }

  // ---- ACTIONS ----
  async function toggleLike() {
    if (!currentUser) return alert("Login to like");
    if (!postId) return;
    if (loadingLike) return;
    setLoadingLike(true);

    const liked = stats.likedByMe;
    setStats((s) => ({
      ...s,
      likedByMe: !liked,
      likesCount: liked ? Math.max(0, s.likesCount - 1) : s.likesCount + 1,
    }));

    try {
      const res = liked
        ? await api.delete(`/api/posts/${postId}/like`)
        : await api.post(`/api/posts/${postId}/like`);
      setStats((s) => ({
        ...s,
        likesCount: res.data?.likesCount ?? s.likesCount,
        likedByMe: !liked,
      }));
    } catch {
      // revert
      setStats((s) => ({
        ...s,
        likedByMe: liked,
        likesCount: liked
          ? s.likesCount + 1
          : Math.max(0, s.likesCount - 1),
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
    const saved = stats.savedByMe;

    setStats((s) => ({
      ...s,
      savedByMe: !saved,
      savesCount: saved ? Math.max(0, s.savesCount - 1) : s.savesCount + 1,
    }));

    try {
      const res = saved
        ? await api.delete(`/api/posts/${postId}/save`)
        : await api.post(`/api/posts/${postId}/save`);
      setStats((s) => ({
        ...s,
        savesCount: res.data?.savesCount ?? s.savesCount,
        savedByMe: !saved,
      }));
    } catch {
      setStats((s) => ({
        ...s,
        savedByMe: saved,
        savesCount: saved
          ? s.savesCount + 1
          : Math.max(0, s.savesCount - 1),
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
      setStats((s) => ({
        ...s,
        sharesCount: res.data?.sharesCount ?? s.sharesCount + 1,
      }));
    } catch {}

    if (navigator.share) {
      try {
        await navigator.share({
          title: post.pro?.name || post.authorName || "Post",
          text: post.text || "",
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

  async function handleToggleComments() {
    const to = !showComments;
    setShowComments(to);
    if (to && comments.length === 0 && postId) {
      try {
        const res = await api.get(`/api/posts/${postId}/comments`);
        setComments(res.data || []);
      } catch {}
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
      authorName:
        currentUser.displayName || currentUser.fullName || "You",
      authorAvatar: currentUser.photoUrl || currentUser.photoURL || "",
      ownerUid: currentUser.uid,
      createdAt: new Date().toISOString(),
    };
    setComments((c) => [optimistic, ...c]);
    setCommentText("");
    setStats((s) => ({ ...s, commentsCount: s.commentsCount + 1 }));

    try {
      const res = await api.post(`/api/posts/${postId}/comments`, {
        text: txt,
      });
      const real = res.data?.comment;
      setComments((c) => [real, ...c.filter((cm) => cm._id !== tmpId)]);
      setStats((s) => ({
        ...s,
        commentsCount: res.data?.commentsCount ?? s.commentsCount,
      }));
    } catch {
      setComments((c) => c.filter((cm) => cm._id !== tmpId));
      setStats((s) => ({
        ...s,
        commentsCount: Math.max(0, s.commentsCount - 1),
      }));
    }
  }

  async function handleDeleteComment(commentId) {
    if (!commentId) return;
    if (!window.confirm("Delete this comment?")) return;
    try {
      await api.delete(`/api/comments/${commentId}`);
      setComments((c) => c.filter((cm) => cm._id !== commentId));
      setStats((s) => ({
        ...s,
        commentsCount: Math.max(0, s.commentsCount - 1),
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

  // stubs
  function handleFollowToggle() {
    alert("Follow / Unfollow will be available soon.");
    setMenuOpen(false);
  }
  function handleReport() {
    alert("Report received. Admin will review.");
    setMenuOpen(false);
  }
  function handleBlockUser() {
    alert("Block user coming soon.");
    setMenuOpen(false);
  }

  const pro = post.pro || {};
  const avatar = pro.photoUrl || post.authorAvatar || "";
  const proName = pro.name || post.authorName || "Professional";
  const lga = pro.lga || post.lga || "";

  return (
    <div className="bg-[#0F0F0F] border border-[#1F1F1F] rounded-xl overflow-hidden">
      {/* header */}
      <div className="flex items-start justify-between px-4 py-3 gap-3">
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center">
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
            <div className="text-sm font-semibold text-white">
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
                    onClick={() =>
                      alert("You can only hide your own post")
                    }
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                  >
                    Hide Post
                  </button>
                )}
                <button
                  onClick={handleReport}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Report Post
                </button>
                <button
                  onClick={handleFollowToggle}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Follow / Unfollow
                </button>
                <button
                  onClick={handleBlockUser}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Block User
                </button>
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

      {/* text */}
      {post.text && (
        <div className="px-4 pb-3 text-sm text-white">{post.text}</div>
      )}

      {/* media */}
      {media && (
        <div className="bg-black">
          {isVideo ? (
            <video
              ref={videoRef}
              src={media.url}
              className="w-full max-h-[420px] object-cover"
              muted
              loop
              playsInline
              preload="metadata"
              controls
              onMouseEnter={onMouseEnterVideo}
              onMouseLeave={onMouseLeaveVideo}
              onClick={onClickVideo}
              onPlay={onVideoPlay}
            />
          ) : (
            <img
              src={media.url}
              alt=""
              className="w-full max-h-[420px] object-cover"
            />
          )}
        </div>
      )}

      {/* counts row */}
      <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-400 border-t border-[#1F1F1F]">
        <div className="flex gap-4">
          <div>{stats.likesCount} likes</div>
          <button onClick={handleToggleComments}>
            {stats.commentsCount} comments
          </button>
          <div>{stats.sharesCount} shares</div>
        </div>
        <div className="flex items-center gap-1">
          <span role="img" aria-label="views">
            👁
          </span>
          <span>View</span>
          <span>{stats.viewsCount}</span>
        </div>
      </div>

      {/* actions */}
      <div className="flex border-t border-[#1F1F1F]">
        <button
          onClick={toggleLike}
          className={`flex-1 py-2 text-sm flex items-center justify-center gap-1 ${
            stats.likedByMe ? "text-[#F5C542]" : "text-gray-200"
          }`}
        >
          👍 {stats.likedByMe ? "Liked" : "Like"}
        </button>
        <button
          onClick={handleToggleComments}
          className="flex-1 py-2 text-sm flex items-center justify-center gap-1 text-gray-200"
        >
          💬 Comment
        </button>
        <button
          onClick={handleShare}
          className="flex-1 py-2 text-sm flex items-center justify-center gap-1 text-gray-200"
        >
          ↗ Share
        </button>
        <button
          onClick={() =>
            alert("Follow / Unfollow will be available soon.")
          }
          className="flex-1 py-2 text-sm flex items-center justify-center gap-1 text-gray-200"
        >
          ➕ Follow
        </button>
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
                    />
                  ) : (
                    (c.authorName || "U").slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="flex-1">
                  <div className="bg-[#141414] rounded-2xl px-3 py-2">
                    <div className="text-xs text-white font-semibold">
                      {c.authorName || "User"}
                    </div>
                    <div className="text-sm text-gray-200">{c.text}</div>
                  </div>
                  <div className="flex gap-3 items-center text-[10px] text-gray-500 mt-1">
                    <span>
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        alert("Comment like coming soon")
                      }
                      className="hover:text-gray-200"
                    >
                      Like
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCommentText((v) =>
                          v
                            ? v + ` @${c.authorName} `
                            : `@${c.authorName} `
                        )
                      }
                      className="hover:text-gray-200"
                    >
                      Reply
                    </button>
                    {currentUser?.uid &&
                      currentUser.uid === c.ownerUid && (
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
              <div className="text-xs text-gray-500">
                No comments yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
