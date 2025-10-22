// apps/web/src/components/FeedCard.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addPostComment, likePost, listPostComments, pingPostView } from "../lib/api";

function timeAgo(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  } catch {
    return "";
  }
}

export default function FeedCard({ post }) {
  const pro = post.pro || {};
  const proId = pro._id || pro.id || post.proId;
  const proName = pro.name || post.authorName || "Professional";
  const lga = pro.lga || post.lga || "—";
  const avatar = pro.photoUrl || post.authorAvatar || "";
  const created = post.createdAt || post.ts;

  const firstMedia = Array.isArray(post.media) && post.media.length ? post.media[0] : null;
  const mediaUrl = firstMedia?.url || post.imageUrl || "";
  const mediaType = firstMedia?.type || (mediaUrl ? "image" : null);

  const tags = Array.isArray(post.tags) ? post.tags.slice(0, 4) : [];

  const [liked, setLiked] = useState(!!post.likedByMe);
  const [likesCount, setLikesCount] = useState(post.likesCount || 0);
  const [viewsCount, setViewsCount] = useState(post.viewsCount || 0);

  const [openComments, setOpenComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [comment, setComment] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);

  // ping view once when card mounts
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await pingPostView(post._id);
        if (alive && r?.viewsCount >= 0) setViewsCount(r.viewsCount);
      } catch {}
    })();
    return () => { alive = false; };
  }, [post._id]);

  async function toggleLike() {
    try {
      const prev = liked;
      const prevCount = likesCount;
      setLiked(!prev);
      setLikesCount(prev ? prevCount - 1 : prevCount + 1);
      const r = await likePost(post._id);
      if (typeof r?.liked === "boolean") setLiked(r.liked);
      if (typeof r?.likesCount === "number") setLikesCount(r.likesCount);
    } catch {
      // revert on error
      setLiked((v) => !v);
      setLikesCount((n) => (liked ? n + 1 : Math.max(0, n - 1)));
    }
  }

  async function loadComments() {
    try {
      const arr = await listPostComments(post._id);
      setComments(Array.isArray(arr) ? arr : []);
    } catch {}
  }

  async function sendComment() {
    if (!comment.trim()) return;
    setCommentBusy(true);
    try {
      const r = await addPostComment(post._id, comment.trim());
      if (r?.comment) setComments((c) => [...c, r.comment]);
      setComment("");
    } catch {}
    setCommentBusy(false);
  }

  function openAndLoad() {
    const next = !openComments;
    setOpenComments(next);
    if (next && !comments.length) loadComments();
  }

  function share() {
    const url = `${window.location.origin}/browse?post=${post._id}`;
    if (navigator.share) {
      navigator.share({ title: proName, text: post.text?.slice(0, 80) || "Kpocha update", url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => alert("Link copied!")).catch(() => {});
    }
  }

  return (
    <article className="rounded-2xl border border-zinc-800 overflow-hidden bg-black/40">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
        {avatar ? (
          <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover border border-zinc-800" />
        ) : (
          <div className="w-10 h-10 rounded-full border border-zinc-800 bg-zinc-900 grid place-items-center font-semibold">
            {String(proName).slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{proName}</div>
          <div className="text-xs text-zinc-500">{lga} • {timeAgo(created)}</div>
        </div>
        <div className="ml-auto">
          {proId && (
            <Link
              to={`/book/${proId}`}
              className="rounded-lg bg-gold text-black text-sm px-3 py-1.5 font-medium hover:opacity-90"
            >
              Book
            </Link>
          )}
        </div>
      </div>

      {/* media */}
      {mediaUrl && (
        <div className="bg-zinc-950">
          <div className="relative w-full" style={{ paddingTop: "75%" }}>
            {mediaType === "video" ? (
              <video src={mediaUrl} className="absolute inset-0 w-full h-full object-cover" controls />
            ) : (
              <img src={mediaUrl} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
            )}
          </div>
        </div>
      )}

      {/* body */}
      <div className="px-4 py-3">
        {post.text && (
          <p className="text-sm text-zinc-200 whitespace-pre-wrap mb-2">{post.text}</p>
        )}
        {!!tags.length && (
          <div className="flex flex-wrap gap-2 mb-3">
            {tags.map((t, i) => (
              <span key={i} className="text-xs border border-zinc-800 rounded-full px-2.5 py-1">#{t}</span>
            ))}
          </div>
        )}

        {/* actions */}
        <div className="flex items-center gap-3 text-sm">
          <button onClick={toggleLike} className="px-2 py-1 rounded hover:bg-zinc-900 border border-zinc-800">
            {liked ? "💛 Liked" : "🤍 Like"} {likesCount ? `· ${likesCount}` : ""}
          </button>
          <button onClick={openAndLoad} className="px-2 py-1 rounded hover:bg-zinc-900 border border-zinc-800">
            💬 Comments {comments?.length ? `· ${comments.length}` : post.commentsCount ? `· ${post.commentsCount}` : ""}
          </button>
          <button onClick={share} className="px-2 py-1 rounded hover:bg-zinc-900 border border-zinc-800">
            🔗 Share
          </button>
          <div className="ml-auto text-xs text-zinc-500">{viewsCount} views</div>
        </div>

        {/* comments */}
        {openComments && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-2">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Write a comment…"
                className="flex-1 bg-black border border-zinc-800 rounded px-2 py-1 text-sm"
              />
              <button
                onClick={sendComment}
                disabled={commentBusy || !comment.trim()}
                className="px-3 py-1.5 text-sm rounded bg-gold text-black disabled:opacity-60"
              >
                {commentBusy ? "Sending…" : "Post"}
              </button>
            </div>

            <div className="space-y-2">
              {comments.map((c) => (
                <div key={c._id} className="text-sm">
                  <span className="font-medium">{c.name || "User"}:</span>{" "}
                  <span className="text-zinc-200">{c.text}</span>
                </div>
              ))}
              {!comments.length && <div className="text-xs text-zinc-500">Be the first to comment.</div>}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
