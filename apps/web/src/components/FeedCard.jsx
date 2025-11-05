import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

/* ---------------- utils ---------------- */
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
function num(n) {
  const x = Number(n || 0);
  if (x >= 1000000) return (x / 1000000).toFixed(1).replace(/\.0$/, "") + "m";
  if (x >= 1000) return (x / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(x);
}

export default function FeedCard({ post, currentUser, onDeleted }) {
  const postId = post._id || post.id;
  const isOwner =
    currentUser?.uid && post.proOwnerUid && currentUser.uid === post.proOwnerUid;

  /* ---------------- state ---------------- */
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
  const [busy, setBusy] = useState({ like: false, save: false, share: false });
  const menuRef = useRef(null);

  /* ---------------- load stats + view ---------------- */
  useEffect(() => {
    if (!postId) return;
    let alive = true;

    (async () => {
      try {
        const res = await api.get(`/api/posts/${postId}/stats`);
        if (alive && res?.data) setStats(res.data);
      } catch {}
    })();

    (async () => {
      try {
        const r = await api.post(`/api/posts/${postId}/view`);
        if (r?.data && r.data.viewsCount != null) {
          setStats((s) => ({ ...s, viewsCount: r.data.viewsCount }));
        }
      } catch {}
    })();

    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("click", onDocClick, true);
    return () => {
      alive = false;
      document.removeEventListener("click", onDocClick, true);
    };
  }, [postId]);

  /* ---------------- actions (no optimistic jumps) ---------------- */
  async function doLike() {
    if (!currentUser) return alert("Login to like");
    if (!postId || busy.like) return;
    setBusy((b) => ({ ...b, like: true }));
    try {
      const already = !!stats.likedByMe;
      const r = already
        ? await api.delete(`/api/posts/${postId}/like`)
        : await api.post(`/api/posts/${postId}/like`);
      if (r?.data) {
        setStats((s) => ({
          ...s,
          likesCount:
            r.data.likesCount != null ? r.data.likesCount : s.likesCount,
          likedByMe: !already,
        }));
      }
    } catch {}
    setBusy((b) => ({ ...b, like: false }));
  }

  async function doSave() {
    if (!currentUser) return alert("Login to save");
    if (!postId || busy.save) return;
    setBusy((b) => ({ ...b, save: true }));
    try {
      const already = !!stats.savedByMe;
      const r = already
        ? await api.delete(`/api/posts/${postId}/save`)
        : await api.post(`/api/posts/${postId}/save`);
      if (r?.data) {
        setStats((s) => ({
          ...s,
          savesCount:
            r.data.savesCount != null ? r.data.savesCount : s.savesCount,
          savedByMe: !already,
        }));
      }
    } catch {}
    setBusy((b) => ({ ...b, save: false }));
  }

  async function doShare() {
    if (!postId || busy.share) return;
    setBusy((b) => ({ ...b, share: true }));
    const base = window.location.origin;
    const url = `${base}/browse?post=${postId}`;

    try {
      const r = await api.post(`/api/posts/${postId}/share`);
      if (r?.data && r.data.sharesCount != null) {
        setStats((s) => ({ ...s, sharesCount: r.data.sharesCount }));
      }
    } catch {}

    try {
      if (navigator.share) {
        await navigator.share({
          title: post.pro?.name || post.authorName || "Kpocha Touch",
          text: post.text || "",
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        alert("Link copied. Paste to share.");
      }
    } catch {
      // user canceled — no problem
    } finally {
      setBusy((b) => ({ ...b, share: false }));
    }
  }

  async function toggleComments() {
    const next = !showComments;
    setShowComments(next);
    if (next && comments.length === 0 && postId) {
      try {
        const res = await api.get(`/api/posts/${postId}/comments`);
        setComments(Array.isArray(res.data) ? res.data : []);
      } catch {}
    }
  }

  async function submitComment(e) {
    e?.preventDefault();
    if (!currentUser) return alert("Login to comment");
    const txt = commentText.trim();
    if (!txt) return;
    try {
      const r = await api.post(`/api/posts/${postId}/comments`, { text: txt });
      const newC = r?.data?.comment;
      if (newC) setComments((c) => [newC, ...c]);
      const cnt = r?.data?.commentsCount;
      if (typeof cnt === "number")
        setStats((s) => ({ ...s, commentsCount: cnt }));
      setCommentText("");
    } catch (err) {
      if (err?.response?.data?.error === "comments_disabled") {
        alert("Comments are turned off for this post.");
      }
    }
  }

  async function deleteComment(id) {
    if (!window.confirm("Delete this comment?")) return;
    try {
      const r = await api.delete(`/api/comments/${id}`);
      setComments((c) => c.filter((x) => x._id !== id));
      const cnt = r?.data?.commentsCount;
      if (typeof cnt === "number")
        setStats((s) => ({ ...s, commentsCount: cnt }));
    } catch {}
  }

  async function hidePost() {
    if (!window.confirm("Hide this post from your feed?")) return;
    try {
      await api.patch(`/api/posts/${postId}/hide`);
      onDeleted?.(postId);
    } catch {
      alert("Failed to hide");
    }
  }

  async function deletePost() {
    if (
      !window.confirm(
        "Delete this post permanently? This cannot be undone."
      )
    )
      return;
    try {
      await api.delete(`/api/posts/${postId}`);
      onDeleted?.(postId);
    } catch {
      alert("Delete failed");
    }
  }

  function copyLink() {
    const base = window.location.origin;
    const url = `${base}/browse?post=${postId}`;
    navigator.clipboard?.writeText(url);
    setMenuOpen(false);
  }

  /* --------------- render --------------- */
  const pro = post.pro || {};
  const avatar = pro.photoUrl || post.authorAvatar || "";
  const proName = pro.name || post.authorName || "Professional";
  const lga = pro.lga || post.lga || "Nigeria";
  const media = Array.isArray(post.media) && post.media.length ? post.media[0] : null;

  return (
    <div className="bg-[#0F0F0F] border border-[#1F1F1F] rounded-xl overflow-hidden">
      {/* header */}
      <div className="flex items-start justify-between px-4 py-3 gap-3">
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
              {lga} • {timeAgo(post.createdAt)}
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
          {/* menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-800 text-white"
              aria-label="More"
              title="More"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-[#141414] border border-[#2a2a2a] rounded-lg shadow-lg z-30 overflow-hidden">
                <button
                  onClick={doSave}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  {stats.savedByMe ? "Unsave post" : "Save post / Add to Collection"}
                </button>
                <button
                  onClick={copyLink}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Copy link
                </button>

                {isOwner ? (
                  <>
                    <button
                      onClick={hidePost}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                    >
                      Hide post
                    </button>
                    <button
                      onClick={deletePost}
                      className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-[#1b1b1b]"
                    >
                      Delete post
                    </button>
                  </>
                ) : (
                  <button
                    onClick={hidePost}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                  >
                    Hide post
                  </button>
                )}

                {/* dummy items for now */}
                <button
                  onClick={() => alert("Report: coming soon")}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Report post
                </button>
                <button
                  onClick={() => alert("Follow/Unfollow: coming soon")}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Follow / Unfollow
                </button>
                <button
                  onClick={() => alert("Block: coming soon")}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Block user
                </button>

                {/* quick nav */}
                <div className="border-t border-[#2a2a2a] my-1" />
                <Link
                  to="/browse"
                  className="block px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Browse
                </Link>
                <Link
                  to="/profile"
                  className="block px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Profile
                </Link>
                <Link
                  to="/settings"
                  className="block px-3 py-2 text-sm hover:bg-[#1b1b1b]"
                >
                  Settings
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* text */}
      {post.text && <div className="px-4 pb-3 text-sm text-white">{post.text}</div>}

      {/* media */}
      {media && (
        <div className="bg-black">
          {media.type === "video" ? (
            <video
              src={media.url}
              autoPlay
              muted
              loop
              playsInline
              controls
              className="w-full max-h-[520px] object-cover"
            />
          ) : (
            <img src={media.url} alt="" className="w-full max-h-[520px] object-cover" />
          )}
        </div>
      )}

      {/* UPPER ROW: counts */}
      <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-400">
        <div className="flex items-center gap-3">
          <div title="Likes">❤️ {num(stats.likesCount)}</div>
          <button
            className="hover:text-gray-200"
            onClick={toggleComments}
            title="Comments"
          >
            💬 {num(stats.commentsCount)}
          </button>
          <div title="Shares">↗ {num(stats.sharesCount)}</div>
        </div>
        <div title="Views">👁 {num(stats.viewsCount)} <span className="ml-1">views</span></div>
      </div>

      {/* LOWER ROW: actions */}
      <div className="flex border-t border-[#1F1F1F]">
        <button
          onClick={doLike}
          className={`flex-1 py-2 text-sm flex items-center justify-center gap-1 ${
            stats.likedByMe ? "text-[#F5C542]" : "text-gray-200"
          }`}
          disabled={busy.like}
        >
          👍 Like
        </button>
        <button
          onClick={toggleComments}
          className="flex-1 py-2 text-sm flex items-center justify-center gap-1 text-gray-200"
        >
          💬 Comment
        </button>
        <button
          onClick={doShare}
          className="flex-1 py-2 text-sm flex items-center justify-center gap-1 text-gray-200"
          disabled={busy.share}
        >
          ↗ Share
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
            <div className="text-xs text-red-400 mb-3">Comments are disabled for this post.</div>
          )}

          <div className="space-y-3">
            {comments.map((c) => {
              const mine = currentUser?.uid && c.ownerUid === currentUser.uid;
              return (
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
                  <div className="bg-[#141414] rounded-2xl px-3 py-2 flex-1">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-white font-semibold">
                        {c.authorName || "User"}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {new Date(c.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-sm text-gray-200 whitespace-pre-wrap">{c.text}</div>

                    {/* comment actions */}
                    <div className="mt-1 text-[11px] text-gray-400 flex gap-3">
                      {mine ? (
                        <button
                          onClick={() => deleteComment(c._id)}
                          className="hover:text-red-400"
                        >
                          Delete
                        </button>
                      ) : (
                        <button
                          onClick={() => alert("Report comment: coming soon")}
                          className="hover:text-gray-200"
                        >
                          Report
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {comments.length === 0 && (
              <div className="text-xs text-gray-500">No comments yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
