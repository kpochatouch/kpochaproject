// apps/web/src/components/FeedCard.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export default function FeedCard({ post, currentUser, currentUid, onDeleted }) {
  // normalize current user
  const effectiveUid = currentUser?.uid || currentUid || null;

  // figure out whose post this is
  const proDoc = post.pro || {};
  const proId =
    proDoc._id ||
    proDoc.id ||
    post.proId ||
    null; // this is what your /book/:id uses
  const authorName = proDoc.name || post.authorName || "Professional";
  const authorAvatar = proDoc.photoUrl || post.authorAvatar || "";
  const authorLga = proDoc.lga || post.lga || "Nigeria";

  const isOwner =
    !!effectiveUid && post.proOwnerUid && effectiveUid === post.proOwnerUid;

  // stats state
  const [stats, setStats] = useState({
    viewsCount: 0,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    savesCount: 0,
    likedByMe: false,
    savedByMe: false,
  });

  // comments state
  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");

  // ui state
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingLike, setLoadingLike] = useState(false);
  const [loadingSave, setLoadingSave] = useState(false);

  // load stats + count view
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await api.get(`/api/posts/${post._id}/stats`);
        if (!stop) {
          setStats((s) => ({ ...s, ...res.data }));
        }
      } catch {
        // ignore
      }
    })();

    // fire-and-forget view
    api.post(`/api/posts/${post._id}/view`).catch(() => {});
    return () => {
      stop = true;
    };
  }, [post._id]);

  async function toggleLike() {
    if (!effectiveUid) {
      alert("Login to like");
      return;
    }
    if (loadingLike) return;
    setLoadingLike(true);
    const wasLiked = stats.likedByMe;

    // optimistic
    setStats((s) => ({
      ...s,
      likedByMe: !wasLiked,
      likesCount: wasLiked ? Math.max(0, s.likesCount - 1) : s.likesCount + 1,
    }));

    try {
      if (!wasLiked) {
        const res = await api.post(`/api/posts/${post._id}/like`);
        setStats((s) => ({
          ...s,
          likesCount: res.data.likesCount ?? s.likesCount,
          likedByMe: true,
        }));
      } else {
        const res = await api.delete(`/api/posts/${post._id}/like`);
        setStats((s) => ({
          ...s,
          likesCount: res.data.likesCount ?? s.likesCount,
          likedByMe: false,
        }));
      }
    } catch {
      // revert
      setStats((s) => ({
        ...s,
        likedByMe: wasLiked,
        likesCount: wasLiked
          ? s.likesCount + 1
          : Math.max(0, s.likesCount - 1),
      }));
    } finally {
      setLoadingLike(false);
    }
  }

  async function toggleSave() {
    if (!effectiveUid) {
      alert("Login to save");
      return;
    }
    if (loadingSave) return;
    setLoadingSave(true);
    const wasSaved = stats.savedByMe;

    // optimistic
    setStats((s) => ({
      ...s,
      savedByMe: !wasSaved,
      savesCount: wasSaved ? Math.max(0, s.savesCount - 1) : s.savesCount + 1,
    }));

    try {
      if (!wasSaved) {
        const res = await api.post(`/api/posts/${post._id}/save`);
        setStats((s) => ({
          ...s,
          savesCount: res.data.savesCount ?? s.savesCount,
          savedByMe: true,
        }));
      } else {
        const res = await api.delete(`/api/posts/${post._id}/save`);
        setStats((s) => ({
          ...s,
          savesCount: res.data.savesCount ?? s.savesCount,
          savedByMe: false,
        }));
      }
    } catch {
      // revert
      setStats((s) => ({
        ...s,
        savedByMe: wasSaved,
        savesCount: wasSaved
          ? s.savesCount + 1
          : Math.max(0, s.savesCount - 1),
      }));
    } finally {
      setLoadingSave(false);
    }
  }

  async function handleShare() {
    if (!effectiveUid) {
      alert("Login to share");
      return;
    }
    try {
      const res = await api.post(`/api/posts/${post._id}/share`);
      setStats((s) => ({
        ...s,
        sharesCount: res.data.sharesCount ?? s.sharesCount + 1,
      }));
    } catch {
      // ignore
    }
  }

  async function loadComments() {
    try {
      const res = await api.get(`/api/posts/${post._id}/comments`);
      setComments(res.data);
    } catch {
      // ignore
    }
  }

  async function handleToggleComments() {
    const next = !showComments;
    setShowComments(next);
    if (next && comments.length === 0) {
      await loadComments();
    }
  }

  async function submitComment(e) {
    e?.preventDefault();
    if (!effectiveUid) return alert("Login to comment");
    const text = commentText.trim();
    if (!text) return;

    const tmpId = "tmp-" + Date.now();
    const optimistic = {
      _id: tmpId,
      postId: post._id,
      text,
      authorName: currentUser?.displayName || "You",
      authorAvatar: currentUser?.photoUrl || "",
      createdAt: new Date().toISOString(),
    };

    setComments((c) => [optimistic, ...c]);
    setCommentText("");
    setStats((s) => ({ ...s, commentsCount: s.commentsCount + 1 }));

    try {
      const res = await api.post(`/api/posts/${post._id}/comments`, { text });
      setComments((c) => [
        res.data.comment,
        ...c.filter((cm) => cm._id !== tmpId),
      ]);
      setStats((s) => ({
        ...s,
        commentsCount: res.data.commentsCount ?? s.commentsCount,
      }));
    } catch (err) {
      // revert
      setComments((c) => c.filter((cm) => cm._id !== tmpId));
      setStats((s) => ({
        ...s,
        commentsCount: Math.max(0, s.commentsCount - 1),
      }));
      if (err?.response?.data?.error === "comments_disabled") {
        alert("Comments are turned off for this post.");
      }
    }
  }

  async function handleDelete() {
    if (!effectiveUid) return alert("Login");
    if (!window.confirm("Delete this post?")) return;
    try {
      await api.delete(`/api/posts/${post._id}`);
      onDeleted?.(post._id);
    } catch {
      alert("Failed to delete");
    }
  }

  async function handleHide() {
    try {
      await api.patch(`/api/posts/${post._id}/hide`);
      onDeleted?.(post._id);
    } catch {
      alert("Failed to hide");
    }
  }

  async function handleDisableComments() {
    try {
      await api.patch(`/api/posts/${post._id}/comments/disable`);
      post.commentsDisabled = true;
      setShowComments(false);
    } catch {
      alert("Failed to disable comments");
    }
  }

  async function handleEnableComments() {
    try {
      await api.patch(`/api/posts/${post._id}/comments/enable`);
      post.commentsDisabled = false;
    } catch {
      alert("Failed to enable comments");
    }
  }

  function handleCopyLink() {
    const base = window.location.origin;
    const url = `${base}/browse?post=${post._id}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setMenuOpen(false);
  }

  const media = Array.isArray(post.media) ? post.media : [];
  const mainMedia = media[0] || null;

  return (
    <div className="bg-[#0F0F0F] border border-[#1F1F1F] rounded-xl overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* avatar */}
        {authorAvatar ? (
          <img
            src={authorAvatar}
            alt={authorName}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-sm text-white">
            {authorName.slice(0, 1)}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-white truncate">
              {authorName}
            </div>
            <span className="text-[10px] text-gray-500">
              {timeAgo(post.createdAt)}
            </span>
          </div>
          <div className="text-xs text-gray-400 truncate">
            {authorLga} • Public
          </div>
        </div>

        {/* real book button */}
        {proId ? (
          <Link
            to={`/book/${proId}`}
            className="hidden sm:inline-flex bg-[#F5C542] text-black text-xs font-semibold px-3 py-1 rounded-md hover:opacity-90"
          >
            Book
          </Link>
        ) : null}

        {/* 3-dot */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-800 text-white"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-[#141414] border border-[#2a2a2a] rounded-lg shadow-lg z-30">
              <button
                onClick={handleCopyLink}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
              >
                Copy link
              </button>
              <button
                onClick={toggleSave}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
              >
                {stats.savedByMe ? "Unsave post" : "Save post"}
              </button>
              {proId && (
                <Link
                  to={`/book/${proId}`}
                  className="block px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                  onClick={() => setMenuOpen(false)}
                >
                  View profile / services
                </Link>
              )}
              {isOwner && (
                <>
                  <button
                    onClick={handleHide}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                  >
                    Hide post
                  </button>
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
                  <button
                    onClick={handleDelete}
                    className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-[#1b1b1b]"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* body text */}
      {post.text && (
        <div className="px-4 pb-3 text-sm text-white whitespace-pre-wrap">
          {post.text}
        </div>
      )}

      {/* media */}
      {mainMedia ? (
        <div className="bg-black">
          {mainMedia.type === "video" ? (
            <video
              src={mainMedia.url}
              controls
              className="w-full max-h-[420px] object-cover"
            />
          ) : (
            <img
              src={mainMedia.url}
              alt=""
              className="w-full max-h-[420px] object-cover"
            />
          )}
        </div>
      ) : null}

      {/* counts row like FB */}
      <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-400">
        <div>{stats.likesCount} likes</div>
        <div className="flex gap-3">
          <button onClick={handleToggleComments}>
            {stats.commentsCount} comments
          </button>
          <div>{stats.sharesCount} shares</div>
        </div>
      </div>

      {/* action bar */}
      <div className="flex border-t border-[#1F1F1F] divide-x divide-[#1F1F1F]">
        <button
          onClick={toggleLike}
          className={`flex-1 py-2 text-sm flex items-center justify-center gap-1 ${
            stats.likedByMe ? "text-[#F5C542]" : "text-gray-200"
          }`}
        >
          👍 Like
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
      </div>

      {/* comments panel */}
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
              <button
                type="submit"
                className="text-sm bg-[#F5C542] text-black rounded-full px-3 py-1"
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
                <div className="w-8 h-8 rounded-full bg-gray-700 overflow-hidden flex items-center justify-center text-xs">
                  {c.authorAvatar ? (
                    <img
                      src={c.authorAvatar}
                      alt={c.authorName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    (c.authorName || "U")[0]
                  )}
                </div>
                <div className="bg-[#141414] rounded-2xl px-3 py-2 flex-1">
                  <div className="text-xs text-white font-semibold">
                    {c.authorName}
                  </div>
                  <div className="text-sm text-gray-200">{c.text}</div>
                  <div className="text-[10px] text-gray-500 mt-1">
                    {new Date(c.createdAt).toLocaleString()}
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
