// apps/web/src/lib/mediaPolicy.js

// ---- Global sound preference (shared) ----
const SOUND_KEY = "kpocha_sound_enabled";

export function getSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundEnabled(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {}
}

// ---- Exclusive playback lock (only one media plays) ----
let active = {
  id: null,
  el: null,
};

export function requestExclusivePlay(id, videoEl) {
  if (!id || !videoEl) return;

  // pause previous
  if (active.el && active.el !== videoEl) {
    try {
      active.el.pause();
    } catch {}
  }

  active = { id, el: videoEl };

  // Apply global sound preference before play
  const wantSound = getSoundEnabled();
  try {
    videoEl.muted = !wantSound;
  } catch {}

  // Attempt play
  try {
    const p = videoEl.play?.();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {}
}

export function pauseIfActive(id, videoEl) {
  if (!id || !videoEl) return;
  if (active.el !== videoEl) return;
  try {
    videoEl.pause();
  } catch {}
}

export function releaseIfActive(id, videoEl) {
  if (!id || !videoEl) return;
  if (active.el !== videoEl) return;
  active = { id: null, el: null };
}

// ---- View tick (once per session, per post) ----
const viewed = new Set();

export function shouldCountViewOnce(postId) {
  if (!postId) return false;
  const k = String(postId);
  if (viewed.has(k)) return false;
  viewed.add(k);
  return true;
}
