//apps/web/src/lib/nativeVideoPlayer.js
import { Capacitor, Plugins } from "@capacitor/core";

const { NativeVideoPlayer } = Plugins || {};

export async function openNativeVideoPlayer({
  url,
  startMs = 0,
  muted = false,
  loop = true,
} = {}) {
  if (!Capacitor.isNativePlatform()) return false;
  if (!NativeVideoPlayer?.open) return false;

  await NativeVideoPlayer.open({ url, startMs, muted, loop });
  return true;
}
