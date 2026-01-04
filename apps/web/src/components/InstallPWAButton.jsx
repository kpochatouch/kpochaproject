// apps/web/src/components/InstallPWAButton.jsx
import { useEffect, useMemo, useState } from "react";

const KEY_LAST_NAG = "kpocha:pwaLastNagAt";
const NAG_EVERY_MS = 12 * 60 * 60 * 1000;

export default function InstallPWAButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [open, setOpen] = useState(false);

  const isStandalone = useMemo(() => {
    const standaloneMatchMedia =
      window.matchMedia?.("(display-mode: standalone)")?.matches;
    const iosStandalone = window.navigator.standalone === true;
    return !!(standaloneMatchMedia || iosStandalone);
  }, []);

  const isIOS = useMemo(() => {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }, []);

  useEffect(() => {
    if (isStandalone) return;

      const onBip = (e) => {
        e.preventDefault();

        // ✅ install is NOW allowed
        if (deferredPrompt) return; // prevent duplicate opens
        setDeferredPrompt(e);
        setOpen(true);

      };

      const onInstalled = () => {
        setOpen(false);
        setDeferredPrompt(null);
      };

      window.addEventListener("beforeinstallprompt", onBip);
      window.addEventListener("appinstalled", onInstalled);


    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [isStandalone]);

  if (isStandalone) return null;
  if (!open) return null;

  async function handleInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      setOpen(false);
      return;
    }

    // No prompt available: show instructions only
    // (button will just close)
    setOpen(false);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 16,
          background: "rgba(17,24,39,0.98)",
          border: "1px solid rgba(255,255,255,0.14)",
          color: "white",
          padding: 16,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
          Install Kpocha Touch
        </div>

        <div style={{ opacity: 0.9, fontSize: 14, lineHeight: 1.45 }}>
          Install Kpocha Touch for easy access, faster opening, and a clean full-screen experience.
        </div>

        <div style={{ marginTop: 10, opacity: 0.9, fontSize: 13, lineHeight: 1.45 }}>
          {isIOS ? (
            <>
              On iPhone: tap <b>Share</b> → <b>Add to Home Screen</b>.
            </>
          ) : deferredPrompt ? (
            <>
              Tap <b>Install</b> to add the app to your phone.
            </>
          ) : (
            <>
              If you don’t see an install prompt: open Chrome menu (⋮) → <b>Install app</b>.
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            onClick={() => setOpen(false)}
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
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              background: "white",
              border: "1px solid rgba(255,255,255,0.18)",
              color: "black",
              fontWeight: 700,
            }}
          >
            Install
          </button>
        </div>
      </div>
    </div>
  );
}
