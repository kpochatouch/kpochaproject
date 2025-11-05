// apps/web/src/components/FeedCard.jsx
import { useEffect, useState } from "react";
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

export default function FeedCard({ post, currentUser, currentUid, onDeleted }) {
  const id = post._id || post.id;
  const pro = post.pro || {};
  const proId = pro._id || post.proId;
  const meUid = currentUser?.uid || currentUid || null;
  const isOwner = meUid && post.proOwnerUid && meUid === post.proOwnerUid;

  const media = Array.isArray(post.media) ? post.media : [];
  const mainMedia = media[0] || null;

  // real stats from backend
  const [stats, setStats] = useState({
    viewsCount: 0,
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    savesCount: 0,
    likedByMe: false,
    savedByMe: false,
  });

  // comments
  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [busyLike, setBusyLike] = useState(false);
  const [busySave, setBusySave] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // load stats + count view
  useEffect(() => {
    if (!id) return;

    let stop = false;

    (async () => {
      try {
        const r = await api.get(`/api/posts/${id}/stats`);
        if (!stop) {
          setStats((s) => ({ ...s, ...r.data }));
        }
      } catch {
        // ignore
      }
    })();

    // count view (fire and forget)
    api.post(`/api/posts/${id}/view`).catch(() => {});
    return () => {
      stop = true;
    };
  }, [id]);

  async function toggleLike() {
    if (!id) return;
    if (!meUid) {
      alert("Login to like");
      return;
    }
    if (busyLike) return;
    setBusyLike(true);
    const wasLiked = stats.likedByMe;
    // optimistic
    setStats((s) => ({
      ...s,
      likedByMe: !wasLiked,
      likesCount: wasLiked ? Math.max(0, s.likesCount - 1) : s.likesCount + 1,
    }));
    try {
      if (!wasLiked) {
        const r = await api.post(`/api/posts/${id}/like`);
        setStats((s) => ({
          ...s,
          likesCount: r.data?.likesCount ?? s.likesCount,
          likedByMe: true,
        }));
      } else {
        const r = await api.delete(`/api/posts/${id}/like`);
        setStats((s) => ({
          ...s,
          likesCount: r.data?.likesCount ?? s.likesCount,
          likedByMe: false,
        }));
      }
    } catch {
      // revert
      setStats((s) => ({
        ...s,
        likedByMe: wasLiked,
        likesCount: wasLiked ? s.likesCount + 1 : Math.max(0, s.likesCount - 1),
      }));
    } finally {
      setBusyLike(false);
    }
  }

  async function toggleSave() {
    if (!id) return;
    if (!meUid) {
      alert("Login to save");
      return;
    }
    if (busySave) return;
    setBusySave(true);
    const wasSaved = stats.savedByMe;
    setStats((s) => ({
      ...s,
      savedByMe: !wasSaved,
      savesCount: wasSaved ? Math.max(0, s.savesCount - 1) : s.savesCount + 1,
    }));
    try {
      if (!wasSaved) {
        const r = await api.post(`/api/posts/${id}/save`);
        setStats((s) => ({
          ...s,
          savesCount: r.data?.savesCount ?? s.savesCount,
          savedByMe: true,
        }));
      } else {
        const r = await api.delete(`/api/posts/${id}/save`);
        setStats((s) => ({
          ...s,
          savesCount: r.data?.savesCount ?? s.savesCount,
          savedByMe: false,
        }));
      }
    } catch {
      setStats((s) => ({
        ...s,
        savedByMe: wasSaved,
        savesCount: wasSaved ? s.savesCount + 1 : Math.max(0, s.savesCount - 1),
      }));
    } finally {
      setBusySave(false);
    }
  }

  async function handleShare() {
    if (!id) return;
    try {
      await api.post(`/api/posts/${id}/share`).catch(() => {});
      const base = window.location.origin;
      const url = `${base}/browse?post=${id}`;
      await navigator.clipboard?.writeText(url);
      setStats((s) => ({
        ...s,
        sharesCount: s.sharesCount + 1,
      }));
      // optional toast
    } catch {
      // ignore
    }
  }

  async function loadComments() {
    if (!id) return;
    try {
      const r = await api.get(`/api/posts/${id}/comments`);
      // backend already returns authorName and authorAvatar
      setComments(Array.isArray(r.data) ? r.data : []);
    } catch {
      // ignore
    }
  }

  async function toggleComments() {
    const to = !showComments;
    setShowComments(to);
    if (to && comments.length === 0) {
      await loadComments();
    }
  }

  async function submitComment(e) {
    e?.preventDefault();
    if (!id) return;
    if (!meUid) {
      alert("Login to comment");
      return;
    }
    const text = commentText.trim();
    if (!text) return;

    try {
      const r = await api.post(`/api/posts/${id}/comments`, { text });
      const newComment = r.data?.comment;
      setComments((prev) => (newComment ? [newComment, ...prev] : prev));
      setStats((s) => ({
        ...s,
        commentsCount: r.data?.commentsCount ?? s.commentsCount + 1,
      }));
      setCommentText("");
    } catch (err) {
      const msg = err?.response?.data?.error;
      if (msg === "comments_disabled") {
        alert("Comments are turned off for this post.");
      }
    }
  }

  async function handleDelete() {
    if (!id) return;
    if (!isOwner) return;
    if (!window.confirm("Delete this post?")) return;
    try {
      await api.delete(`/api/posts/${id}`);
      onDeleted?.(id);
    } catch {
      alert("Failed to delete");
    }
  }

  return (
    <article className="rounded-xl border border-zinc-800 bg-black/40 overflow-hidden flex flex-col">
      {/* header */}
      <header className="flex items-center gap-3 px-4 py-3">
        {pro.photoUrl ? (
          <img
            src={pro.photoUrl}
            alt={pro.name || "Pro"}
            className="w-10 h-10 rounded-full object-cover border border-zinc-700"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-sm">
            {(pro.name || post.authorName || "P").slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">
              {pro.name || post.authorName || "Professional"}
            </p>
            <span className="text-[10px] text-zinc-500">{timeAgo(post.createdAt)}</span>
          </div>
          <p className="text-xs text-zinc-500 truncate">
            {pro.lga || post.lga || ""}
          </p>
        </div>
        {proId ? (
          <Link
            to={`/book/${proId}`}
            className="text-xs rounded-md bg-gold text-black px-3 py-1 font-semibold"
          >
            Book
          </Link>
        ) : null}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-7 h-7 rounded-full hover:bg-zinc-900 text-zinc-200 text-sm"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-40 bg-black border border-zinc-800 rounded-lg z-30 text-sm">
              <button
                onClick={handleShare}
                className="w-full text-left px-3 py-2 hover:bg-zinc-900"
              >
                Copy link
              </button>
              <button
                onClick={toggleSave}
                className="w-full text-left px-3 py-2 hover:bg-zinc-900"
              >
                {stats.savedByMe ? "Unsave" : "Save"}
              </button>
              {isOwner && (
                <button
                  onClick={handleDelete}
                  className="w-full text-left px-3 py-2 text-red-300 hover:bg-red-950/30"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* text */}
      {post.text ? (
        <p className="px-4 pb-3 text-sm text-zinc-200 whitespace-pre-wrap">
          {post.text}
        </p>
      ) : null}

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
              alt="post media"
              className="w-full max-h-[420px] object-cover"
            />
          )}
        </div>
      ) : null}

      {/* counts line like Facebook */}
      <div className="flex items-center justify-between px-4 py-2 text-[11px] text-zinc-400">
        <div>{stats.likesCount} likes</div>
        <div className="flex gap-3">
          <button onClick={toggleComments}>{stats.commentsCount} comments</button>
          <div>{stats.sharesCount} shares</div>
        </div>
      </div>

      {/* action bar */}
      <div className="flex border-t border-zinc-800 text-sm">
        <button
          onClick={toggleLike}
          className={`flex-1 py-2 flex items-center justify-center gap-1 ${
            stats.likedByMe ? "text-gold" : "text-zinc-200"
          }`}
        >
          👍 Like
        </button>
        <button
          onClick={toggleComments}
          className="flex-1 py-2 flex items-center justify-center gap-1 text-zinc-200"
        >
          💬 Comment
        </button>
        <button
          onClick={handleShare}
          className="flex-1 py-2 flex items-center justify-center gap-1 text-zinc-200"
        >
          ↗ Share
        </button>
      </div>

      {/* comments section */}
      {showComments && (
        <div className="px-4 py-3 border-t border-zinc-800">
          {!post.commentsDisabled ? (
            <form onSubmit={submitComment} className="flex gap-2 mb-3">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment…"
                className="flex-1 bg-black/40 border border-zinc-700 rounded-full px-3 py-2 text-sm text-zinc-100"
              />
              <button className="text-sm bg-gold text-black rounded-full px-4 py-1.5">
                Post
              </button>
            </form>
          ) : (
            <div className="text-xs text-red-400 mb-3">Comments are disabled.</div>
          )}
          <div className="space-y-3">
            {comments.map((c) => (
              <div key={c._id} className="flex gap-2 items-start">
                <div className="w-8 h-8 rounded-full bg-zinc-700 overflow-hidden flex items-center justify-center text-xs">
                  {c.authorAvatar ? (
                    <img src={c.authorAvatar} alt={c.authorName} className="w-full h-full object-cover" />
                  ) : (
                    (c.authorName || "U").slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="bg-zinc-900/60 rounded-2xl px-3 py-2 flex-1">
                  <div className="text-xs font-semibold text-zinc-100">{c.authorName || "User"}</div>
                  <div className="text-sm text-zinc-100">{c.text}</div>
                  <div className="text-[10px] text-zinc-500 mt-1">
                    {timeAgo(c.createdAt)}
                  </div>
                </div>
              </div>
            ))}
            {comments.length === 0 && (
              <div className="text-xs text-zinc-500">No comments yet.</div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
