//apps/web/src/lib/nativeVideoPlayer.js
import { Capacitor } from "@capacitor/core";

let NativeVideoPlayer = null;

async function getNativeVideoPlayer() {
  // Only attempt on native platforms
  if (!Capacitor.isNativePlatform()) return null;

  // Capacitor v5+ plugin access pattern
  if (NativeVideoPlayer) return NativeVideoPlayer;

  try {
    const mod = await import("capacitor-native-video-player");
    NativeVideoPlayer = mod?.NativeVideoPlayer || null;
    return NativeVideoPlayer;
  } catch (e) {
    console.warn("[NativeVideoPlayer] plugin not available:", e);
    return null;
  }
}
export async function openNativeVideoPlayer({
  url,
  startMs = 0,
  muted = false,
  loop = true,
} = {}) {
  const p = await getNativeVideoPlayer();
  if (!p?.open) return false;

  await p.open({ url, startMs, muted, loop });
  return true;
}

export async function closeNativeVideoPlayer() {
  const p = await getNativeVideoPlayer();
  if (!p?.close) return false;

  await p.close();
  return true;
}
