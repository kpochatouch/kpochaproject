//apps/web/src/components/ClickOutsideLayer.jsx
import { useEffect } from "react";

export default function ClickOutsideLayer() {
  useEffect(() => {
    const handler = (e) => {
      // broadcast the click event globally
      window.dispatchEvent(new CustomEvent("global-click", { detail: e }));
    };

    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);

    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  return null; // invisible component
}
