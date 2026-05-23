// apps/web/src/lib/hlsAttach.js
// Small helper: attach .m3u8 to a <video> element using native HLS (Safari)
// or hls.js (Chrome/Android/Desktop).

export function isHlsUrl(url) {
  const u = String(url || "").toLowerCase();
  return u.includes(".m3u8");
}

function estimateStartLevel() {
  if (typeof navigator === "undefined") return 0;
  const connection =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection;
  if (!connection) return 0;

  const effectiveType = String(connection.effectiveType || "").toLowerCase();
  const downlink = Number(connection.downlink || 0);
  const rtt = Number(connection.rtt || 0);

  if (effectiveType.includes("2g") || effectiveType === "slow-2g") {
    return 0;
  }
  if (effectiveType === "3g" || (downlink > 0 && downlink < 1.5)) {
    return 0;
  }
  if (effectiveType === "4g" || downlink >= 1.5) {
    return 1;
  }
  if (rtt > 200) {
    return 0;
  }

  return 0;
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

  const startLevel = estimateStartLevel();
  const hls = new Hls({
    // tuned for slow networks and feed usage
    enableWorker: true,
    lowLatencyMode: false,
    // keep buffer modest to avoid large memory usage on low-end devices
    backBufferLength: 30,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    // choose a conservative start level based on current network conditions
    startLevel,
    startFragPrefetch: true,
    // prefer levels matching player size to avoid unnecessarily large streams
    capLevelToPlayerSize: true,
    // make ABR more conservative so it doesn't ramp up too aggressively
    abrBandWidthUpFactor: 0.6,
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
