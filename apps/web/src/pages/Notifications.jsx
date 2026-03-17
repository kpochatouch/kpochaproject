//apps/web/src/pages/Notifications.jsx
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import useNotifications from "../hooks/useNotifications";
import MobileBackButton from "../components/MobileBackButton";
import RouteLoader from "../components/RouteLoader.jsx";

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

const NOTIFICATION_ROUTES = {
  chat_message: (n) => {
    const peerUid =
      n?.actorUid ||
      n?.data?.fromUid ||
      n?.data?.peerUid ||
      n?.data?.callerUid ||
      null;

    const room = n?.data?.room || null;

    if (peerUid) {
      return `/chat?with=${encodeURIComponent(peerUid)}`;
    }

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

function getAvatar(n) {
  return n?.meta?.actorAvatar || n?.data?.actorAvatar || null;
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { items, markRead, markAll, loading } = useNotifications();

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

  async function handleOpen(entry) {
    try {
      if (!entry.seen && entry.id) {
        await markRead(entry.id);
      }
    } catch {}

    if (entry.target) {
      navigate(entry.target);
    }
  }

  if (loading) {
    return <RouteLoader full />;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <MobileBackButton fallback="/" />
          <div>
            <h1 className="text-2xl font-semibold">Notifications</h1>
            <p className="text-xs text-zinc-500">
              Your activity, messages, calls and updates.
            </p>
          </div>
        </div>

        {enhanced.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              try {
                await markAll();
              } catch {}
            }}
            className="text-xs px-3 py-2 rounded-lg border border-zinc-800"
          >
            Mark all read
          </button>
        )}
      </div>

      {enhanced.length === 0 ? (
        <div className="border border-zinc-800 rounded-xl bg-black/40 px-4 py-10 text-center text-sm text-zinc-400">
          No notifications yet
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded-xl overflow-hidden">
          {enhanced.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => handleOpen(n)}
                className={`w-full text-left p-4 transition ${
                  n.seen ? "bg-black" : "bg-zinc-900/60"
                } hover:bg-zinc-800`}
              >
                <div className="flex items-start gap-3">
                  {n.avatar ? (
                    <img
                      src={n.avatar}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="text-xl leading-none mt-1">{n.icon}</div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{n.title}</div>

                    {n.body && (
                      <div className="text-xs text-zinc-300 mt-0.5">
                        {n.body}
                      </div>
                    )}

                    <div className="text-[11px] text-zinc-500 mt-1">
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
  );
}
