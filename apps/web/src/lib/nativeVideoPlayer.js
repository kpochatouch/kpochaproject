// apps/web/src/lib/nativeVideoPlayer.js
import { Capacitor } from "@capacitor/core";
import { registerPlugin } from "@capacitor/core";

// This must match @CapacitorPlugin(name = "NativeVideoPlayer") in Android
const NativeVideoPlayer = registerPlugin("NativeVideoPlayer");

export async function openNativeVideoPlayer({
  url,
  startMs = 0,
  muted = false,
  loop = true,
} = {}) {
  if (!Capacitor.isNativePlatform()) return false;
  if (!url) return false;

  try {
    await NativeVideoPlayer.open({ url, startMs, muted, loop });
    return true;
  } catch (e) {
    console.warn("[NativeVideoPlayer] open failed", e);
    return false;
  }
}

// You do NOT have a close() method in your Java plugin yet.
// Keep this as a safe stub so calls won't crash if you still import it somewhere.
export async function closeNativeVideoPlayer() {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    // If you later implement NativeVideoPlayer.close on Android, this will work.
    if (typeof NativeVideoPlayer.close === "function") {
      await NativeVideoPlayer.close();
      return true;
    }
  } catch (e) {
    console.warn("[NativeVideoPlayer] close failed", e);
  }
  return false;
}
