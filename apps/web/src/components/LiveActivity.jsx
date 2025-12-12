// apps/web/src/components/LiveActivity.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, connectSocket, registerSocketHandler } from "../lib/api";

export default function LiveActivity({ ownerUid }) {
  const [items, setItems] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!ownerUid) return;
    let mounted = true;

    (async () => {
      try {
        const { data } = await api.get(
          `/api/activity/${encodeURIComponent(ownerUid)}?limit=20`
        );
        if (!mounted) return;
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch (e) {
        console.warn("[LiveActivity] initial load failed", e?.message || e);
      }
    })();

    try {
      connectSocket();
    } catch (e) {
      console.warn("[LiveActivity] socket connect failed", e?.message || e);
    }

    // when a new post is created by this owner, prepend a synthetic activity row
    const unregister =
      typeof registerSocketHandler === "function"
        ? registerSocketHandler("post:created", (payload) => {
            try {
              if (!payload) return;
              const owner =
                payload.ownerUid ||
                payload.proOwnerUid ||
                payload.createdBy ||
                null;
              if (!owner || String(owner) !== String(ownerUid)) return;

              const item = {
                kind: "post",
                createdAt: payload.createdAt || new Date().toISOString(),
                targetPostId: payload._id || payload.id || null,
                payload: {
                  text: payload.text || "",
                },
              };

              setItems((prev) => [item, ...prev].slice(0, 50));
            } catch (err) {
              console.warn("[LiveActivity] post:created handler failed", err);
            }
          })
        : null;



    return () => {
      mounted = false;
      if (unregister) unregister();
    };
  }, [ownerUid]);

  if (!ownerUid) return null;

  // 🚫 For PUBLIC profile, hide private activity:
  // - bookings (should be private)
  // - comments (often tied to private posts/clients)
  const visibleItems = items.filter((it) => {
    if (!it) return false;
    if (it.kind === "booking") return false;
    if (it.kind === "comment") return false;
    return true; // keep "post", "follow", etc.
  });


  const handleClickPost = (postId) => {
    if (!postId) return;
    // ⚠️ If your post details route is different, just adjust this path.
    navigate(`/post/${encodeURIComponent(postId)}`);
  };

  const formatLabel = (it) => {
    const kind = it.kind || "";
    if (kind === "post") return "New post";
    if (kind === "comment") return "New comment";
    if (kind === "follow") return "New follower";
    if (kind === "booking") return "New booking";
    return "Activity";
  };

  const formatText = (it) => {
    const p = it.payload || {};
    return (
      p.text ||
      p.body ||
      p.message ||
      p.title ||
      "" // fallback: empty, we won't show JSON
    );
  };

  return (
    <div className="space-y-2">
      {visibleItems.length === 0 && (
        <div className="text-xs text-zinc-500">No recent activity</div>
      )}


      {visibleItems.slice(0, 10).map((it, idx) => {
  const label = formatLabel(it);
  const text = formatText(it);
  const ts = it.createdAt ? new Date(it.createdAt) : null;

  // Only treat activity of kind "post" as pointing to a post.
  let postId = null;

  if (it.kind === "post") {
    const p = it.payload || {};
    postId =
      it.targetPostId ||
      it.postId ||
      p.postId ||
      p._id ||
      p.id ||
      null;
  }

  const clickable = it.kind === "post" && !!postId;

  return (
    <button
      key={idx}
      type="button"
      onClick={() => (clickable ? handleClickPost(postId) : null)}
      className={[
        "w-full text-left rounded-md px-2 py-1.5",
        "bg-zinc-950/40 border border-zinc-800/70",
        clickable ? "hover:bg-zinc-900 cursor-pointer" : "cursor-default",
      ].join(" ")}
    >
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>

      {text ? (
        <div className="mt-0.5 text-xs text-zinc-200 line-clamp-2">
          {text}
        </div>
      ) : null}

      {ts && (
        <div className="mt-0.5 text-[10px] text-zinc-600">
          {ts.toLocaleString()}
        </div>
      )}
    </button>
  );
})}
    </div>
  );
}
