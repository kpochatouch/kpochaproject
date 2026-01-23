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

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    }),
  );
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

  if (type === "chat_message" && data.room) {
    url = `/chat?room=${encodeURIComponent(data.room)}`;
  } else if (type === "post_like" && data.postId) {
    url = `/post/${encodeURIComponent(data.postId)}`;
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
  } else if (type === "call_incoming" || type === "call_missed") {
    url = "/inbox";
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        // Focus existing window if possible
        for (const client of clientsArr) {
          try {
            if ("navigate" in client) client.navigate(url);
            if ("focus" in client) return client.focus();
          } catch {}
        }
        // Otherwise open a new window
        if (self.clients.openWindow) return self.clients.openWindow(url);
        return null;
      }),
  );
});
