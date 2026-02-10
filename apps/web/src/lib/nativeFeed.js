//apps/web/src/lib/nativeFeed.js
import { Capacitor } from "@capacitor/core";
import { registerPlugin } from "@capacitor/core";
import { api } from "./api"; // ✅ re-use the same ROOT the app already uses

const NativeFeed = registerPlugin("NativeFeed");

export async function openNativeFeed({ lga = "" } = {}) {
  if (!Capacitor.isNativePlatform()) return false;

  // Prefer explicit server root (best), then axios baseURL
  // Match api.js env keys (avoid “env mismatch”)
  const apiBase =
    (import.meta?.env?.VITE_API_BASE_URL || "").toString().trim() ||
    (import.meta?.env?.VITE_API_BASE || "").toString().trim() ||
    (api?.defaults?.baseURL || "").toString().trim();

  if (!apiBase) {
    console.warn(
      "[NativeFeed] missing apiBase. Set VITE_API_ROOT or api.defaults.baseURL.",
    );
    return false;
  }

  // token optional — native feed endpoint (/posts/public) works without it
  let token = "";
  try {
    token = localStorage.getItem("token") || "";
  } catch {}

  try {
    await NativeFeed.open({ apiBase, lga, token });
    return true;
  } catch (e) {
    console.warn("[NativeFeed] open failed", e);
    return false;
  }
}
