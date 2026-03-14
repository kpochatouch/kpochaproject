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

      const damped = Math.min(maxPull, delta * 0.48);
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
  const easedProgress = 1 - Math.pow(1 - progress, 2.2);

  const containerTranslateY = refreshing
    ? 16
    : pullY > 0
    ? Math.min(26, Math.max(-54, pullY - 56))
    : -54;

  const opacity = refreshing ? 1 : pullY > 1 ? Math.min(1, progress * 1.2) : 0;

  const scale = refreshing ? 1 : 0.82 + easedProgress * 0.18;

  // full pull rotation before refresh
  const arrowRotate = refreshing ? 0 : easedProgress * 360;

  // ring progress
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - easedProgress);

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[140] pointer-events-none flex justify-center"
      style={{
        transform: `translateY(${containerTranslateY}px)`,
        opacity,
        transition: refreshing || pullY > 0 ? "none" : "all 220ms ease",
      }}
      aria-hidden="true"
    >
      <div
        className="mt-2 h-12 w-12 rounded-full border border-white/10 bg-zinc-900/92 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-md flex items-center justify-center"
        style={{
          transform: `scale(${scale})`,
          transition: refreshing || pullY > 0 ? "none" : "transform 220ms ease",
        }}
      >
        <div className="relative h-6 w-6 flex items-center justify-center">
          {/* soft track */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="absolute inset-0"
          >
            <circle
              cx="12"
              cy="12"
              r={radius}
              stroke="currentColor"
              strokeWidth="2.2"
              opacity="0.16"
            />
          </svg>

          {refreshing ? (
            <svg
              className="absolute inset-0 animate-spin"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r={radius}
                stroke="currentColor"
                strokeWidth="2.2"
                opacity="0.16"
              />
              <path
                d="M22 12a10 10 0 0 0-10-10"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <>
              {/* progress ring */}
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="absolute inset-0 -rotate-90"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  opacity={0.28 + easedProgress * 0.72}
                />
              </svg>

              {/* rotating refresh arrow */}
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                style={{
                  transform: `rotate(${arrowRotate}deg)`,
                  transition: pullY > 0 ? "none" : "transform 180ms ease",
                }}
              >
                <path
                  d="M20 12a8 8 0 1 0-2.34 5.66"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.92}
                />
                <path
                  d="M20 7v5h-5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
