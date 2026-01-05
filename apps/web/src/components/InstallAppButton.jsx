import { useEffect, useState, useMemo } from "react";

export default function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

  const isStandalone = useMemo(() => {
    return (
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true
    );
  }, []);

  const isIOS = useMemo(() => {
    return (
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }, []);

  const isSafari = useMemo(() => {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  }, []);

  useEffect(() => {
    function onBip(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  if (isStandalone) return null;

  async function handleInstall() {
    // ✅ Android / Chromium real install
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      return;
    }

    // ✅ iOS (manual path)
    setShowHelp(true);
  }

  return (
    <>
      <button
        onClick={handleInstall}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          fontWeight: 700,
          background: "white",
          color: "black",
          border: "none",
        }}
      >
        Install App
      </button>

      {showHelp && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              maxWidth: 420,
              width: "100%",
              background: "#111827",
              color: "white",
              borderRadius: 16,
              padding: 16,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>
            Install Kpocha Touch
            </div>
            <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 12 }}>
            Your browser doesn’t show an install button automatically.
            Follow the steps below to add the app to your Home Screen.
            </div>


            {isIOS ? (
            isSafari ? (
                <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    iPhone / iPad (Safari)
                </div>
                <ol style={{ paddingLeft: 18, lineHeight: 1.6 }}>
                    <li>Tap the <b>Share</b> icon at the bottom of Safari</li>
                    <li>Select <b>Add to Home Screen</b></li>
                    <li>Tap <b>Add</b> to finish</li>
                </ol>
                </>
            ) : (
                <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    iPhone / iPad (Other browsers)
                </div>
                <p style={{ lineHeight: 1.5 }}>
                    Apple only allows app installation from Safari.
                </p>
                <p style={{ fontSize: 14, opacity: 0.85 }}>
                    Open this page in Safari, then use
                    <b> Share → Add to Home Screen</b>.
                </p>
                </>
            )
            ) : (
            <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Android / Other browsers
                </div>
                <p>
                Open your browser menu (⋮) and tap <b>Install app</b>.
                </p>
            </>
            )}


            <button
              onClick={() => setShowHelp(false)}
              style={{
                marginTop: 12,
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                background: "transparent",
                color: "white",
                border: "1px solid rgba(255,255,255,0.2)",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
