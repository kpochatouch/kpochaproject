// apps/web/public/sw.js
/* global self */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Push event: display OS notification (NO caching).
 * Backend sends: { title, body, data: {...} }
 */
self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // If payload isn't JSON, fallback safely
    try {
      payload = { title: "Kpocha Touch", body: event.data?.text?.() || "" };
    } catch {
      payload = { title: "Kpocha Touch", body: "New notification" };
    }
  }

  const title = payload?.title || "Kpocha Touch";
  const body = payload?.body || "";
  const data = payload?.data || {};

  const type = data?.type || "generic";
  const isCall =
    type === "call_incoming" ||
    type === "incoming_call" ||
    type === "call_missed";

  const isBooking = type === "booking_paid" || type === "booking_update";

  const actorAvatar = data?.actorAvatar || data?.fromAvatar || "";
  const previewImage =
    data?.image ||
    data?.thumbnailUrl ||
    data?.previewImage ||
    data?.postThumbnail ||
    "";

  const notifOptions = {
    body,
    data,
    icon: actorAvatar || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    image: previewImage || undefined,

    // collapse duplicates for the same live event
    tag:
      (isCall && data?.callId && `call:${data.callId}`) ||
      (isBooking && data?.bookingId && `booking:${data.bookingId}`) ||
      undefined,

    // make replacement notifications notify again
    renotify: Boolean(isCall || isBooking),

    // keep visible until user acts (best-effort; browser/OS decides)
    requireInteraction: Boolean(isCall || isBooking),

    // ask OS for sound/vibration if supported
    silent: false,

    // Android/compatible platforms may use this
    vibrate: isCall
      ? [300, 150, 300, 150, 700]
      : isBooking
      ? [200, 120, 200, 120, 400]
      : undefined,
  };

  event.waitUntil(self.registration.showNotification(title, notifOptions));
});

/**
 * Click notification: open existing tab or new tab, and deep-link.
 * NO caching.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification?.data || {};
  const type = data.type || "generic";

  let url = "/";

  if (type === "call_missed") {
    const peerUid = data.peerUid || data.fromUid || data.callerUid || "";
    const room = data.room || "";

    if (peerUid) {
      url = `/chat?with=${encodeURIComponent(peerUid)}`;
    } else if (room) {
      url = `/chat?room=${encodeURIComponent(room)}`;
    } else {
      url = "/inbox";
    }
  }
  // ✅ live incoming call opens call sheet
  else if (
    type === "call_incoming" ||
    type === "incoming_call" ||
    data.callRoom ||
    data.call_room ||
    ((data.callId || data.call_id) &&
      (data.room || data.callRoom || data.call_room))
  ) {
    const callId = data.callId || data.call_id || "";
    const room = data.room || data.callRoom || data.call_room || "";
    const callType = data.callType || data.call_type || "audio";

    const fromName = data.fromName || data.callerName || "";
    const fromAvatar = data.fromAvatar || data.callerAvatar || "";

    url =
      `/browse?call=1&accept=1` +
      `&callId=${encodeURIComponent(callId)}` +
      `&room=${encodeURIComponent(room)}` +
      `&callType=${encodeURIComponent(callType)}` +
      `&fromName=${encodeURIComponent(fromName)}` +
      `&fromAvatar=${encodeURIComponent(fromAvatar)}`;
  } else if (type === "chat_message") {
    const peerUid =
      data.peerUid || data.fromUid || data.actorUid || data.callerUid || "";

    if (peerUid) {
      url = `/chat?with=${encodeURIComponent(peerUid)}`;
    } else if (data.room) {
      url = `/chat?room=${encodeURIComponent(data.room)}`;
    } else {
      url = "/inbox";
    }
  } else if (
    ["post_like", "post_comment", "new_post"].includes(type) &&
    data.postId
  ) {
    url = `/post/${encodeURIComponent(data.postId)}`;
  } else if (type === "follow") {
    if (data.username) {
      url = `/profile/${encodeURIComponent(data.username)}`;
    } else {
      url = "/browse";
    }
  } else if (type === "booking_update" && data.bookingId) {
    url = `/bookings/${encodeURIComponent(data.bookingId)}`;
  } else if (type === "booking_update") {
    url = "/my-bookings";
  } else if (
    [
      "withdraw",
      "withdraw_pending",
      "booking_fund",
      "booking_fund_refund",
      "release",
    ].includes(type)
  ) {
    url = "/wallet";
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        for (const client of clientsArr) {
          try {
            if ("navigate" in client) client.navigate(url);
            if ("focus" in client) return client.focus();
          } catch {}
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
        return null;
      }),
  );
});
