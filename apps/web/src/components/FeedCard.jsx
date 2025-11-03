// apps/web/src/components/FeedCard.jsx
import { useState } from "react";
import { Link } from "react-router-dom";

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
  const [lightbox, setLightbox] = useState("");

  const pro = post.pro || {};
  const proId = pro._id || pro.id || post.proId;
  const proName = pro.name || post.authorName || "Professional";
  const lga = pro.lga || post.lga || "—";
  const avatar = pro.photoUrl || post.authorAvatar || "";
  const created = post.createdAt || post.ts;

  const media = Array.isArray(post.media) && post.media.length ? post.media[0] : null;
  const mediaUrl = media?.url || post.imageUrl || "";
  const mediaType = media?.type || (mediaUrl ? "image" : null);

  const tags = Array.isArray(post.tags) ? post.tags.slice(0, 4) : [];

  return (
    <article className="rounded-2xl border border-zinc-800 overflow-hidden bg-black/40">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
        {avatar ? (
          <button
            type="button"
            onClick={() => setLightbox(avatar)}
            className="w-10 h-10 rounded-full overflow-hidden border border-zinc-800"
            title="Click to view photo"
          >
            <img src={avatar} alt="" className="w-full h-full object-cover" loading="lazy" />
          </button>
        ) : (
          <div className="w-10 h-10 rounded-full border border-zinc-800 bg-zinc-900 grid place-items-center font-semibold">
            {String(proName).slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{proName}</div>
          <div className="text-xs text-zinc-500">
            {lga} • {timeAgo(created)}
          </div>
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

      {/* media (image or video) */}
      {mediaUrl && (
        <div className="bg-zinc-950">
          <div className="relative w-full" style={{ paddingTop: "75%" }}>
            {mediaType === "video" ? (
              <video
                src={mediaUrl}
                className="absolute inset-0 w-full h-full object-cover"
                controls
              />
            ) : (
              <img
                src={mediaUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                onClick={() => setLightbox(mediaUrl)}
              />
            )}
          </div>
        </div>
      )}

      {/* body */}
      <div className="px-4 py-3">
        {post.text && (
          <p className="text-sm text-zinc-200 whitespace-pre-wrap mb-2">
            {post.text}
          </p>
        )}
        {!!tags.length && (
          <div className="flex flex-wrap gap-2 mb-3">
            {tags.map((t, i) => (
              <span key={i} className="text-xs border border-zinc-800 rounded-full px-2.5 py-1">
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {proId && (
            <Link
              to={`/book/${proId}`}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
            >
              View services
            </Link>
          )}
          {proId && (
            <Link
              to={`/book/${proId}`}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
            >
              Profile
            </Link>
          )}
        </div>
      </div>

      {/* lightbox for avatar/media */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setLightbox("")}
        >
          <div className="max-w-3xl max-h-[85vh] rounded-xl overflow-hidden border border-zinc-700">
            <img src={lightbox} alt="preview" className="block max-h-[85vh] object-contain" />
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * NOTES (FeedCard.jsx)
 * 1. Avatar and media are now clickable to enlarge → fixes “avatars don’t click to expand”.
 * 2. We still prefer data from post.pro (pro doc) but fall back to post.* fields.
 * 3. We didn’t add any fake/demo phone, bio, or LGA — real info will show.
 */
