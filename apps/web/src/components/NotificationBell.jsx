//apps/web/src/components/NotificationBell.jsx
import React, { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import useNotifications from "../hooks/useNotifications";

const NOTIFICATION_ROUTES = {
  chat_message: (n) => {
    const peerUid =
      n?.actorUid ||
      n?.data?.fromUid ||
      n?.data?.peerUid ||
      n?.data?.callerUid ||
      null;

    const room = n?.data?.room || null;

    // ✅ Prefer DM peer navigation whenever we know the other user
    if (peerUid) {
      return `/chat?with=${encodeURIComponent(peerUid)}`;
    }

    // ✅ Fallback only for room-only conversations
    if (room) {
      return `/chat?room=${encodeURIComponent(room)}`;
    }

    return "/inbox";
  },

  call_incoming: (n) => {
    const peerUid =
      n?.actorUid || n?.data?.callerUid || n?.data?.fromUid || null;

    const room = n?.data?.room || null;
    const callId = n?.data?.callId || null;
    const callType = n?.data?.callType || "audio";
    const fromName =
      n?.data?.fromName || n?.data?.callerName || n?.meta?.actorName || "";
    const fromAvatar =
      n?.data?.fromAvatar ||
      n?.data?.callerAvatar ||
      n?.meta?.actorAvatar ||
      "";

    if (room && callId) {
      const qs = new URLSearchParams();
      qs.set("call", "1");
      qs.set("accept", "1");
      qs.set("callId", String(callId));
      qs.set("room", String(room));
      qs.set("callType", String(callType));
      if (fromName) qs.set("fromName", String(fromName));
      if (fromAvatar) qs.set("fromAvatar", String(fromAvatar));
      return `/browse?${qs.toString()}`;
    }

    if (peerUid) {
      return `/chat?with=${encodeURIComponent(peerUid)}`;
    }

    if (room) {
      return `/chat?room=${encodeURIComponent(room)}`;
    }

    return "/inbox";
  },

  call_missed: (n) => {
    const peerUid =
      n?.actorUid || n?.data?.callerUid || n?.data?.fromUid || null;

    const room = n?.data?.room || null;

    // ✅ Missed call should open the person conversation when possible
    if (peerUid) {
      return `/chat?with=${encodeURIComponent(peerUid)}`;
    }

    if (room) {
      return `/chat?room=${encodeURIComponent(room)}`;
    }

    return "/inbox";
  },

  post_like: (n) => (n?.data?.postId ? `/post/${n.data.postId}` : null),

  booking_update: (n) =>
    n?.data?.bookingId ? `/bookings/${n.data.bookingId}` : "/my-bookings",

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
    const who =
      data.actorName || n?.meta?.actorName || data.fromName || "Someone";

    return {
      icon: "💬",
      title: who,
      body: data.bodyPreview || "Sent you a message",
      target,
    };
  }

  if (type === "call_incoming") {
    const who =
      data.fromName || data.callerName || n?.meta?.actorName || "Someone";

    return {
      icon: "📞",
      title: `${who} is calling`,
      body: `Incoming ${data.callType === "video" ? "video" : "voice"} call`,
      target,
    };
  }

  if (type === "call_missed") {
    const who =
      data.fromName || data.callerName || n?.meta?.actorName || "Someone";

    return {
      icon: "📞",
      title: "Missed call",
      body: `${who} tried to reach you`,
      target,
    };
  }

  if (type === "post_like") {
    const who = n?.meta?.actorName || "Someone";
    return {
      icon: "❤️",
      title: "New like",
      body: `${who} liked your post`,
      target,
    };
  }

  if (type === "booking_update") {
    return {
      icon: "📅",
      title: "Booking update",
      body: data.body || data.message || "Your booking was updated",
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
      body: data.body || data.message || "Wallet activity updated",
      target,
    };
  }

  return {
    icon: "🔔",
    title: data.title || "Notification",
    body: data.body || data.message || "",
    target,
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
  const isMobile = window.matchMedia("(max-width: 768px)").matches;

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
        onClick={() => {
          if (isMobile) {
            navigate("/notifications");
            return;
          }
          setOpen((o) => !o);
        }}
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
