// apps/web/src/lib/pushClient.js
import { api } from "./api";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export async function ensurePushSubscribed() {
  if (!("serviceWorker" in navigator)) return { ok: false, reason: "no_sw" };
  if (!("PushManager" in window)) return { ok: false, reason: "no_push" };
  if (!("Notification" in window))
    return { ok: false, reason: "no_notification" };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "permission_denied" };

  const reg = await navigator.serviceWorker.ready;

  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";
  if (!publicKey) return { ok: false, reason: "missing_vapid_public_key" };

  const applicationServerKey = urlBase64ToUint8Array(publicKey);

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  await api.post("/api/push/subscribe", { subscription: sub });
  return { ok: true };
}
