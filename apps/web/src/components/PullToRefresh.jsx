//apps/web/src/components/PullToRefresh.jsx
import { useEffect, useRef, useState } from "react";

export default function PullToRefresh({
  disabled = false,
  threshold = 84,
  maxPull = 110,
}) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const pullYRef = useRef(0);
  const triggeredRef = useRef(false);

  function isScrollableElement(el) {
    if (!el || el === document.body || el === document.documentElement) {
      return false;
    }

    try {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      return (
        (overflowY === "auto" || overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight
      );
    } catch {
      return false;
    }
  }

  function findScrollableParent(el) {
    let node = el;
    while (
      node &&
      node !== document.body &&
      node !== document.documentElement
    ) {
      if (isScrollableElement(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function canStartPull(target) {
    if (disabled) return false;

    const tag = target?.tagName?.toLowerCase?.() || "";
    if (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      target?.isContentEditable
    ) {
      return false;
    }

    const scroller = findScrollableParent(target);
    if (scroller) return scroller.scrollTop <= 0;

    return window.scrollY <= 0;
  }

  useEffect(() => {
    function onTouchStart(e) {
      if (!e.touches || !e.touches.length) return;

      if (!canStartPull(e.target)) {
        pullingRef.current = false;
        pullYRef.current = 0;
        setPullY(0);
        return;
      }

      startYRef.current = e.touches[0].clientY;
      pullingRef.current = true;
      pullYRef.current = 0;
      triggeredRef.current = false;
      setPullY(0);
    }

    function onTouchMove(e) {
      if (!pullingRef.current) return;
      if (!e.touches || !e.touches.length) return;

      const currentY = e.touches[0].clientY;
      const delta = currentY - startYRef.current;

      if (delta <= 0) {
        pullYRef.current = 0;
        setPullY(0);
        return;
      }

      const damped = Math.min(maxPull, delta * 0.45);
      pullYRef.current = damped;
      setPullY(damped);

      if (window.scrollY <= 0) {
        e.preventDefault();
      }
    }

    function onTouchEnd() {
      if (!pullingRef.current) return;

      const shouldRefresh = pullYRef.current >= threshold;

      pullingRef.current = false;
      pullYRef.current = 0;
      setPullY(0);

      if (shouldRefresh && !triggeredRef.current) {
        triggeredRef.current = true;
        setRefreshing(true);
        window.location.reload();
      }
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [disabled, threshold, maxPull]);

  const progress = Math.max(0, Math.min(1, pullY / threshold));
  const topOffset = Math.min(18, Math.max(-52, pullY - 52));
  const opacity = refreshing ? 1 : pullY > 2 ? 1 : 0;
  const scale = refreshing ? 1 : 0.86 + progress * 0.14;
  const rotate = refreshing ? 0 : progress * 180;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[140] pointer-events-none flex justify-center"
      style={{
        transform: `translateY(${topOffset}px)`,
        opacity,
        transition: refreshing || pullY > 0 ? "none" : "all 0.18s ease",
      }}
      aria-hidden="true"
    >
      <div
        className="mt-2 h-11 w-11 rounded-full border border-zinc-700 bg-zinc-900/95 shadow-lg backdrop-blur-sm flex items-center justify-center"
        style={{
          transform: `scale(${scale})`,
          transition: refreshing || pullY > 0 ? "none" : "transform 0.18s ease",
        }}
      >
        {refreshing ? (
          <svg
            className="animate-spin"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="8"
              stroke="currentColor"
              strokeWidth="2.4"
              opacity="0.22"
            />
            <path
              d="M20 12a8 8 0 0 0-8-8"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            style={{
              transform: `rotate(${rotate}deg)`,
              transition: "transform 0.12s linear",
            }}
          >
            <path
              d="M20 11a8 8 0 1 0 2 5.3"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.35 + progress * 0.65}
            />
            <path
              d="M20 4v7h-7"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
