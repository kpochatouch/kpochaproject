//apps/web/src/lib/nativeFeed.js
import { Capacitor } from "@capacitor/core";
import { registerPlugin } from "@capacitor/core";
import { api } from "./api"; // ✅ re-use the same ROOT the app already uses

const NativeFeed = registerPlugin("NativeFeed");

export async function openNativeFeed({
  lga = "",
  startPostId = "",
  startIndex = -1,
} = {}) {
  if (!Capacitor.isNativePlatform()) return false;

  const apiBase = api?.defaults?.baseURL || "";
  if (!apiBase) return false;

  // token optional — native feed endpoint (/posts/public) works without it
  let token = "";
  try {
    token = localStorage.getItem("token") || "";
  } catch {}

  try {
    await NativeFeed.open({ apiBase, lga, token, startPostId, startIndex });
    return true;
  } catch (e) {
    console.warn("[NativeFeed] open failed", e);
    return false;
  }
}
