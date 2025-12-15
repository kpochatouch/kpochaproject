import { useEffect, useMemo, useState } from "react";

const KEY_LAST_NAG = "kpocha:pwaLastNagAt";
const NAG_EVERY_MS = 12 * 60 * 60 * 1000; // 12 hours

export default function InstallPWAButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);

  const isStandalone = useMemo(() => {
    // Android/Chrome
    const standaloneMatchMedia =
      window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;

    // iOS Safari
    const iosStandalone = window.navigator.standalone === true;

    return standaloneMatchMedia || iosStandalone;
  }, []);

  useEffect(() => {
    if (isStandalone) return; // already installed/running as app

    const onBip = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // we still control when to show the banner
    };

    const onInstalled = () => {
      setShow(false);
      setDeferredPrompt(null);
      try {
        localStorage.removeItem(KEY_LAST_NAG);
      } catch {}
    };

    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    // show banner on first load, then every 12 hours
    try {
      const last = Number(localStorage.getItem(KEY_LAST_NAG) || "0");
      const now = Date.now();
      if (!last || now - last >= NAG_EVERY_MS) {
        setShow(true);
        localStorage.setItem(KEY_LAST_NAG, String(now));
      }
    } catch {
      setShow(true); // if storage blocked, still show
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [isStandalone]);

  if (isStandalone) return null;
  if (!show) return null;

  const canPrompt = !!deferredPrompt; // Chrome/Edge
  const isIOS =
    /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShow(false);
  }

  function dismiss() {
    setShow(false);
  }

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 14,
        zIndex: 9999,
        borderRadius: 14,
        padding: 14,
        background: "rgba(17,24,39,0.95)",
        border: "1px solid rgba(255,255,255,0.14)",
        color: "white",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        Install Kpocha Touch for easy access
      </div>

      {isIOS && !canPrompt ? (
        <div style={{ opacity: 0.9, fontSize: 13, lineHeight: 1.35 }}>
          On iPhone: tap <b>Share</b> → <b>Add to Home Screen</b>.
        </div>
      ) : (
        <div style={{ opacity: 0.9, fontSize: 13, lineHeight: 1.35 }}>
          Get the app on your phone. Faster opening and a cleaner full-screen experience.
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button
          onClick={dismiss}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 10,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.18)",
            color: "white",
          }}
        >
          Not now
        </button>

        <button
          onClick={handleInstall}
          disabled={!canPrompt}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 10,
            background: canPrompt ? "white" : "rgba(255,255,255,0.25)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: canPrompt ? "black" : "rgba(255,255,255,0.8)",
            cursor: canPrompt ? "pointer" : "not-allowed",
          }}
          title={!canPrompt ? "Install is not available yet. Refresh the page once." : ""}
        >
          Install App
        </button>
      </div>
    </div>
  );
}
