self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 🔑 harmless presence-only fetch handler
self.addEventListener("fetch", () => {});
