// apps/web/src/components/FeedCard.jsx
import { useEffect, useState } from "react";
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

export default function FeedCard({ post, currentUid, onDeleted }) {
  const id = post._id || post.id;
  const author = post.pro || {};
  const media = Array.isArray(post.media) ? post.media : [];
  const mainMedia = media[0] || null;
  const isOwner = currentUid && post.proOwnerUid && currentUid === post.proOwnerUid;

  const [likes, setLikes] = useState(0);
  const [views, setViews] = useState(0);
  const [saves, setSaves] = useState(0);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // count a view
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const r = await api.post(`/api/posts/${id}/view`);
        setViews(r.data?.viewsCount ?? (v => v) ?? 0);
      } catch {
        // ignore
      }
    })();
  }, [id]);

  async function toggleLike() {
    if (!id) return;
    try {
      setBusy(true);
      if (liked) {
        const r = await api.delete(`/api/posts/${id}/like`);
        setLikes(r.data?.likesCount ?? 0);
        setLiked(false);
      } else {
        const r = await api.post(`/api/posts/${id}/like`);
        setLikes(r.data?.likesCount ?? (likes + 1));
        setLiked(true);
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  async function toggleSave() {
    if (!id) return;
    try {
      setBusy(true);
      if (saved) {
        const r = await api.delete(`/api/posts/${id}/save`);
        setSaves(r.data?.savesCount ?? 0);
        setSaved(false);
      } else {
        const r = await api.post(`/api/posts/${id}/save`);
        setSaves(r.data?.savesCount ?? (saves + 1));
        setSaved(true);
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  async function doShare() {
    if (!id) return;
    try {
      setBusy(true);
      await api.post(`/api/posts/${id}/share`);
      // optional: copy link
      try {
        await navigator.clipboard.writeText(window.location.origin + "/browse?post=" + id);
      } catch {
        // ignore clipboard failure
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!id) return;
    if (!window.confirm("Delete this post?")) return;
    try {
      await api.delete(`/api/posts/${id}`);
      onDeleted?.();
    } catch {
      // ignore
    }
  }

  return (
    <article className="rounded-xl border border-zinc-800 bg-black/40 overflow-hidden flex flex-col">
      {/* header */}
      <header className="flex items-center gap-3 px-4 py-3">
        {author.photoUrl ? (
          <img
            src={author.photoUrl}
            alt={author.name || "Pro"}
            className="w-10 h-10 rounded-full object-cover border border-zinc-700"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-sm">
            {(author.name || "P").slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">
              {author.name || post.authorName || "Professional"}
            </p>
            <span className="text-[10px] text-zinc-500">{timeAgo(post.createdAt)}</span>
          </div>
          <p className="text-xs text-zinc-500 truncate">
            {author.lga || post.lga || ""}
          </p>
        </div>
        {/* small book button like your cards */}
        <button className="text-xs rounded-md bg-gold text-black px-3 py-1 font-semibold">
          Book
        </button>
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
              className="w-full aspect-[4/3] object-cover"
            />
          ) : (
            <img
              src={mainMedia.url}
              alt="post media"
              className="w-full aspect-[4/3] object-cover"
            />
          )}
        </div>
      ) : null}

      {/* actions */}
      <footer className="px-4 py-3 flex items-center gap-2 flex-wrap border-t border-zinc-800">
        <button
          onClick={toggleLike}
          disabled={busy}
          className={`text-xs px-3 py-1.5 rounded-md border ${
            liked ? "bg-zinc-100 text-black border-zinc-100" : "border-zinc-700 text-zinc-200"
          }`}
        >
          ❤️ Like {likes ? `(${likes})` : ""}
        </button>
        <button
          onClick={doShare}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-200"
        >
          ↗ Share
        </button>
        <button
          onClick={toggleSave}
          disabled={busy}
          className={`text-xs px-3 py-1.5 rounded-md border ${
            saved ? "bg-zinc-100 text-black border-zinc-100" : "border-zinc-700 text-zinc-200"
          }`}
        >
          💾 Save {saves ? `(${saves})` : ""}
        </button>
        <button
          disabled
          className="text-xs px-3 py-1.5 rounded-md border border-zinc-800 text-zinc-500"
          title="Comments not wired yet"
        >
          💬 Comment
        </button>
        <span className="ml-auto text-[10px] text-zinc-500">
          {views ? `${views} views` : ""}
        </span>
        {isOwner ? (
          <button
            onClick={doDelete}
            className="text-[10px] text-red-300 border border-red-500/40 rounded px-2 py-1"
          >
            Delete
          </button>
        ) : null}
      </footer>
    </article>
  );
}
