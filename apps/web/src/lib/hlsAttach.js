// apps/web/src/lib/hlsAttach.js
// Small helper: attach .m3u8 to a <video> element using native HLS (Safari)
// or hls.js (Chrome/Android/Desktop).

export function isHlsUrl(url) {
  const u = String(url || "").toLowerCase();
  return u.includes(".m3u8");
}

export async function attachHlsToVideo(videoEl, src) {
  if (!videoEl || !src) return () => {};

  // 1) Safari / iOS / some browsers with native HLS
  const canNative =
    typeof videoEl.canPlayType === "function" &&
    videoEl.canPlayType("application/vnd.apple.mpegurl");

  if (canNative) {
    // native HLS: just set src
    videoEl.src = src;
    videoEl.setAttribute("src", src);
    try {
      videoEl.load();
    } catch {}
    return () => {};
  }

  // 2) hls.js for everyone else
  const mod = await import("hls.js");
  const Hls = mod.default;

  if (!Hls || !Hls.isSupported()) {
    // last resort: try direct
    videoEl.src = src;
    videoEl.setAttribute("src", src);
    try {
      videoEl.load();
    } catch {}
    return () => {};
  }

  const hls = new Hls({
    // keep defaults mostly; safe for feeds
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 90,
  });

  hls.loadSource(src);
  hls.attachMedia(videoEl);

  // soft recovery so one bad segment doesn’t kill the feed
  hls.on(Hls.Events.ERROR, (_evt, data) => {
    try {
      if (!data?.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
      hls.destroy();
    } catch {}
  });

  return () => {
    try {
      hls.destroy();
    } catch {}
  };
}
