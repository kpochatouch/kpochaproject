// apps/web/src/lib/pushClient.js
import { api } from "./api";

export function getDeviceId() {
  try {
    let id = localStorage.getItem("kpocha:deviceId");
    if (!id) {
      id =
        (crypto?.randomUUID ? crypto.randomUUID() : null) ||
        `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      localStorage.setItem("kpocha:deviceId", id);
    }
    return id;
  } catch {
    // storage blocked; still return a best-effort ID for this session
    return `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

export function detectWebSurface() {
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true;

  const surfaceType = isStandalone ? "pwa" : "browser";

  let surfaceKey = "";
  try {
    const keyName = `kpocha:${surfaceType}:surfaceKey`;
    surfaceKey = localStorage.getItem(keyName) || "";
    if (!surfaceKey) {
      surfaceKey =
        (crypto?.randomUUID ? crypto.randomUUID() : null) ||
        `${surfaceType}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(keyName, surfaceKey);
    }
  } catch {
    surfaceKey = `${surfaceType}_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}`;
  }

  return { surfaceType, surfaceKey };
}

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

  const { surfaceType, surfaceKey } = detectWebSurface();

  await api.post("/api/push/subscribe", {
    subscription: sub,
    deviceId: getDeviceId(),
    surfaceType,
    surfaceKey,
  });
  return { ok: true };
}
