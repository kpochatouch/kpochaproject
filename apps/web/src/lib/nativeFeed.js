//apps/web/src/lib/nativeFeed.js
// apps/web/src/lib/nativeFeed.js
import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeFeed = registerPlugin("NativeFeed");

export async function openNativeFeed({
  lga = "",
  startPostId = "",
  startIndex = -1,
} = {}) {
  if (!Capacitor.isNativePlatform()) return false;

  // token optional — native feed endpoint works without it
  let token = "";
  try {
    token = localStorage.getItem("token") || "";
  } catch {}

  // IMPORTANT:
  // Do NOT block if apiBase is empty.
  // Your NativeFeedActivity already has a fallback to BuildConfig.API_BASE.
  const apiBase = ""; // let Android fallback to BuildConfig.API_BASE

  try {
    console.log("[NativeFeed] calling NativeFeed.open()", {
      apiBase,
      lga,
      hasToken: !!token,
      startPostId,
      startIndex,
    });

    await NativeFeed.open({ apiBase, lga, token, startPostId, startIndex });

    console.log("[NativeFeed] NativeFeed.open() OK");
    return true;
  } catch (e) {
    console.warn("[NativeFeed] NativeFeed.open() FAILED", e);
    return false;
  }
}
