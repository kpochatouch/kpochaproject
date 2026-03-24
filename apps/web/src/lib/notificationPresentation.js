//apps/web/src/lib/notificationPresentation.js
export const NOTIFICATION_ROUTES = {
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

  // historical notifications should NOT reopen live call UI
  call_incoming: (n) => {
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

  call_ended: (n) => {
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
  post_comment: (n) => (n?.data?.postId ? `/post/${n.data.postId}` : null),

  new_post: (n) =>
    n?.data?.postId
      ? `/post/${n.data.postId}`
      : n?.data?.username
      ? `/profile/${encodeURIComponent(n.data.username)}`
      : n?.actorUid
      ? `/profile/${encodeURIComponent(n.actorUid)}`
      : "/browse",

  follow: (n) =>
    n?.data?.username
      ? `/profile/${encodeURIComponent(n.data.username)}`
      : n?.actorUid
      ? `/profile/${encodeURIComponent(n.actorUid)}`
      : "/browse",

  booking_update: (n) =>
    n?.data?.bookingId ? `/bookings/${n.data.bookingId}` : "/my-bookings",

  booking_fund: () => "/wallet",
  booking_fund_refund: () => "/wallet",
  withdraw: () => "/wallet",
  withdraw_pending: () => "/wallet",
  release: () => "/wallet",
  support_escalated: (n) =>
    n?.data?.url ||
    (n?.data?.sessionId
      ? `/admin/support?session=${encodeURIComponent(n.data.sessionId)}`
      : "/admin/support"),

  generic: () => null,
};

export function formatNotificationTime(ts) {
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

export function presentNotification(n) {
  const data = n.data || {};
  const type = n.type || "generic";

  const resolver = NOTIFICATION_ROUTES[type];
  const target = resolver ? resolver(n) : null;

  const who =
    data.actorName ||
    n?.meta?.actorName ||
    data.fromName ||
    data.callerName ||
    "Someone";

  const callLabel = data.callType === "video" ? "video" : "voice";

  if (type === "chat_message") {
    return {
      icon: "💬",
      title: who,
      body: data.bodyPreview || "Sent you a message",
      target,
    };
  }

  if (type === "call_incoming") {
    return {
      icon: "📞",
      title: who,
      body: `Incoming ${callLabel} call`,
      target,
    };
  }

  if (type === "call_missed") {
    return {
      icon: "📞",
      title: who,
      body: `Missed ${callLabel} call`,
      target,
    };
  }

  if (type === "call_ended") {
    return {
      icon: "📞",
      title: who,
      body: "Call ended",
      target,
    };
  }

  if (type === "post_like") {
    return {
      icon: "❤️",
      title: "New like",
      body: `${who} liked your post`,
      target,
    };
  }

  if (type === "post_comment") {
    return {
      icon: "💭",
      title: "New comment",
      body: `${who} commented on your post`,
      target,
    };
  }

  if (type === "new_post") {
    return {
      icon: "📝",
      title: who,
      body: data.body || "Shared a new post",
      target,
    };
  }

  if (type === "follow") {
    return {
      icon: "➕",
      title: "New follower",
      body: `${who} started following you`,
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

  if (type === "support_escalated") {
    return {
      icon: "🆘",
      title: data.title || "Support escalation",
      body:
        data.body || data.message || "A support conversation needs attention",
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

export function getNotificationAvatar(n) {
  return n?.meta?.actorAvatar || n?.data?.actorAvatar || null;
}
