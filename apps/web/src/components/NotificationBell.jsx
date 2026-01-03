import React, { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import useNotifications from "../hooks/useNotifications";

/* ---------------------------
   Helpers
----------------------------*/

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString();
}

/**
 * Turn raw notification → human sentence
 * This is the “missing realism” layer
 */
function presentNotification(n) {
  const type = n.type;
  const data = n.data || {};

  switch (type) {
    case "chat_message":
      return {
        title: "New message",
        body: data.body || data.message || "You received a new message",
        target: "/inbox",
        icon: "💬",
      };

    case "call_missed":
      return {
        title: "Missed call",
        body: "You missed a call",
        target: "/inbox",
        icon: "📞",
      };

    case "post_like":
      return {
        title: "New like",
        body: data.message || "Someone liked your post",
        target: data.postId ? `/post/${data.postId}` : "/",
        icon: "❤️",
      };

    case "booking_update":
      return {
        title: "Booking update",
        body: data.message || "Your booking was updated",
        target: "/my-bookings",
        icon: "📅",
      };

    case "follow":
      return {
        title: "New follower",
        body: "Someone started following you",
        target: data.username
          ? `/profile/${data.username}`
          : "/profile",
        icon: "👤",
      };

    default:
      return {
        title: "Notification",
        body: data.body || data.message || "",
        target: "/",
        icon: "🔔",
      };
  }
}

/* ---------------------------
   Component
----------------------------*/

export default function NotificationBell() {
  const navigate = useNavigate();
  const { items, unread, markRead } = useNotifications();

  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  /* Close on outside click */
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

  const enhanced = useMemo(
    () =>
      items.map((n) => ({
        ...presentNotification(n),
        id: n._id || n.id,
        seen: n.seen,
        createdAt: n.createdAt,
        raw: n,
      })),
    [items]
  );

  async function handleClick(entry) {
    try {
      if (!entry.seen && entry.id) {
        await markRead(entry.id);
      }
    } catch {}

    setOpen(false);
    navigate(entry.target || "/");
  }

  return (
    <div ref={rootRef} className="relative">
      {/* Bell */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative inline-flex items-center justify-center
                   w-9 h-9 rounded-full border border-zinc-800
                   bg-black/40 hover:bg-zinc-900 transition"
      >
        🔔
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px]
                       px-1.5 py-0.5 text-[10px]
                       rounded-full bg-red-600 text-white font-semibold"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto
                     bg-black border border-zinc-800 rounded-xl
                     shadow-xl z-40"
        >
          {enhanced.length === 0 ? (
            <div className="p-4 text-xs text-zinc-500 text-center">
              No notifications yet
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {enhanced.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className={`w-full text-left p-3 transition
                      ${n.seen ? "bg-black" : "bg-zinc-900/60"}
                      hover:bg-zinc-800`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-lg">{n.icon}</div>

                      <div className="flex-1">
                        <div className="text-[12px] font-semibold">
                          {n.title}
                        </div>

                        {n.body && (
                          <div className="text-[11px] text-zinc-300 mt-0.5">
                            {n.body}
                          </div>
                        )}

                        <div className="text-[10px] text-zinc-500 mt-1">
                          {formatTime(n.createdAt)}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
