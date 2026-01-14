//apps/web/src/components/NotificationBell.jsx
import React, { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import useNotifications from "../hooks/useNotifications";

const NOTIFICATION_ROUTES = {
  chat_message: (n) => {
    const room = n?.data?.room;
    return room ? `/chat?room=${encodeURIComponent(room)}` : "/inbox";
  },

  call_incoming: () => "/inbox",
  call_missed: () => "/inbox",

  post_like: (n) => (n?.data?.postId ? `/post/${n.data.postId}` : null),

  booking_update: () => "/my-bookings",

  booking_fund: () => "/wallet",
  booking_fund_refund: () => "/wallet",
  withdraw: () => "/wallet",
  withdraw_pending: () => "/wallet",
  release: () => "/wallet",

  generic: () => null,
};

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
 * Inbox-style semantic presentation
 */
function presentNotification(n) {
  const data = n.data || {};
  const type = n.type || "generic";

  const resolver = NOTIFICATION_ROUTES[type];
  const target = resolver ? resolver(n) : null;

  if (type === "chat_message") {
    return {
      icon: "💬",
      title: "New message",
      body: data.bodyPreview || "New message",
      target,
    };
  }

  if (type === "call_incoming") {
    return {
      icon: "📞",
      title: "Incoming call",
      body: "Tap to respond",
      target,
    };
  }

  if (type === "call_missed") {
    return {
      icon: "📞",
      title: "Missed call",
      body: "You missed a call",
      target,
    };
  }

  if (type === "post_like") {
    return {
      icon: "❤️",
      title: "New like",
      body: "Someone liked your post",
      target,
    };
  }

  if (type === "booking_update") {
    return {
      icon: "📅",
      title: "Booking update",
      body: "Your booking was updated",
      target,
    };
  }

  if (
    [
      "withdraw",
      "withdraw_pending",
      "booking_fund",
      "booking_fund_refund",
      "release",
    ].includes(type)
  ) {
    return {
      icon: "💰",
      title: "Wallet update",
      body: "Wallet balance changed",
      target,
    };
  }

  return {
    icon: "🔔",
    title: "Notification",
    body: data.message || "",
    target: null,
  };
}

/**
 * ✅ Safe avatar rule
 * No fetch, no crash, graceful fallback
 */
function getAvatar(n) {
  return n?.meta?.actorAvatar || n?.data?.actorAvatar || null;
}

/* ---------------------------
   Component
----------------------------*/

export default function NotificationBell() {
  const navigate = useNavigate();
  const { items, unread, markRead, markAll } = useNotifications();

  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Close on outside click
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

  // Enhance once
  const enhanced = useMemo(
    () =>
      items.map((n) => {
        const view = presentNotification(n);
        return {
          ...view,
          id: n._id || n.id,
          seen: n.seen,
          createdAt: n.createdAt,
          avatar: getAvatar(n),
          raw: n,
        };
      }),
    [items],
  );

  async function handleClick(entry) {
    try {
      if (!entry.seen && entry.id) {
        await markRead(entry.id);
      }
    } catch {}

    setOpen(false);
    if (entry.target) navigate(entry.target);
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
          className="
          absolute mt-2
          left-1/2 -translate-x-1/2
          w-[92vw] max-w-sm
          max-h-[70vh] overflow-y-auto
          bg-black border border-zinc-800 rounded-xl
          shadow-xl z-40
        "
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="text-xs font-semibold text-zinc-300">
              Notifications
            </span>

            {enhanced.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await markAll();
                  } catch {}
                }}
                className="text-xs text-gold hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {enhanced.length === 0 ? (
            <div className="p-4 text-xs text-zinc-500 text-center">
              No notifications yet
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800 overscroll-contain">
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
                      {n.avatar ? (
                        <img
                          src={n.avatar}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="text-lg">{n.icon}</div>
                      )}

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
