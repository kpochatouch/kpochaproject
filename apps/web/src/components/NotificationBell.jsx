// apps/web/src/components/NotificationBell.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useNotifications from "../hooks/useNotifications";

function resolveTarget(notification) {
  const { type, data = {}, meta = {} } = notification;

  switch (type) {
    case "chat_message":
      if (data.room) return `/chat?room=${encodeURIComponent(data.room)}`;
      if (data.withUid) return `/chat?with=${encodeURIComponent(data.withUid)}`;
      return "/inbox";

    case "call_missed":
      return "/inbox";

    case "post_like":
      return data.postId ? `/post/${data.postId}` : "/";

    case "booking_update":
      return data.bookingId ? `/bookings/${data.bookingId}` : "/my-bookings";

    case "follow":
      return data.username
        ? `/profile/${data.username}`
        : data.actorUid
        ? `/profile/${data.actorUid}`
        : "/";

    default:
      return "/";
  }
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const { items, unread, markRead } = useNotifications();

  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  /* ---------------- Outside click ---------------- */
  useEffect(() => {
    function onGlobalClick(e) {
      const target = e?.detail?.target;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    }

    window.addEventListener("global-click", onGlobalClick);
    return () => window.removeEventListener("global-click", onGlobalClick);
  }, []);

  /* ---------------- Click handler ---------------- */
  async function handleItemClick(n) {
    try {
      if (!n.seen && (n._id || n.id)) {
        await markRead(n._id || n.id);
      }
    } catch {}

    setOpen(false);

    const target = resolveTarget(n);
    if (target) navigate(target);
  }

  return (
    <div ref={rootRef} className="relative">
      {/* Bell */}
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-full
                   border border-zinc-800 bg-black/40 hover:bg-zinc-900 transition"
      >
        <span aria-hidden="true">🔔</span>

        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] px-1.5 py-0.5
                       text-[10px] rounded-full bg-red-600 text-white font-semibold"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto
                     bg-black border border-zinc-800 rounded-xl shadow-xl z-40"
        >
          {items.length === 0 ? (
            <div className="p-4 text-xs text-zinc-500 text-center">
              No notifications yet
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {items.map((n) => {
                const id = n._id || n.id;
                const createdAt = n.createdAt
                  ? new Date(n.createdAt)
                  : null;

                const title =
                  n.data?.title ||
                  n.meta?.label ||
                  n.type ||
                  "Notification";

                const body =
                  n.data?.body ||
                  n.data?.message ||
                  n.meta?.preview ||
                  "";

                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(n)}
                      className={`w-full text-left p-3 transition
                        ${n.seen ? "bg-black" : "bg-zinc-900/60"}
                        hover:bg-zinc-800`}
                    >
                      <div className="flex flex-col gap-1">
                        <div className="text-[12px] font-semibold">
                          {title}
                        </div>

                        {body && (
                          <div className="text-[11px] text-zinc-300">
                            {body}
                          </div>
                        )}

                        {createdAt && (
                          <div className="text-[10px] text-zinc-500">
                            {createdAt.toLocaleString()}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
