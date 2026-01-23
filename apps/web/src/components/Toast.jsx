// apps/web/src/components/Toast.jsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const ToastCtx = createContext(null);
const FADE_MS = 600; // fade-out duration before removal

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const audioOkRef = useRef(null);
  const audioErrRef = useRef(null);

  // ✅ timers ref must live at component top-level (NOT inside push)
  const timersRef = useRef(new Map());
  const fadeTimersRef = useRef(new Map());

  // Optional sounds (your files are in /public/sound)
  useEffect(() => {
    try {
      audioOkRef.current = new Audio("/sound/ok.mp3");
      audioErrRef.current = new Audio("/sound/error.mp3");

      audioOkRef.current.preload = "auto";
      audioErrRef.current.preload = "auto";

      audioOkRef.current.volume = 0.5;
      audioErrRef.current.volume = 0.7;
    } catch {
      // ignore
    }
  }, []);

  const dismiss = useCallback((id) => {
    // clear any timer for this toast
    const tm = timersRef.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timersRef.current.delete(id);
    }

    const ft = fadeTimersRef.current.get(id);
    if (ft) {
      clearTimeout(ft);
      fadeTimersRef.current.delete(id);
    }

    // 1) mark as closing (fade out)
    setItems((prev) =>
      prev.map((t) => (t.id === id ? { ...t, closing: true } : t)),
    );

    // 2) after fade, remove from DOM
    const ft2 = setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
      fadeTimersRef.current.delete(id);
    }, FADE_MS);

    fadeTimersRef.current.set(id, ft2);
  }, []);

  // ✅ cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const tm of timersRef.current.values()) clearTimeout(tm);
      timersRef.current.clear();
      for (const tm of fadeTimersRef.current.values()) clearTimeout(tm);
      fadeTimersRef.current.clear();
    };
  }, []);

  const push = useCallback(
    (t) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const toast = {
        id,
        tone: t.tone || "info",
        title: t.title || "",
        msg: t.msg || "",
        ttl: t.ttl ?? (t.tone === "error" ? 10000 : 5000),
      };

      setItems((prev) => {
        const next = [];
        for (const x of prev) {
          const xTone = x.tone || "info";
          if (xTone === toast.tone) {
            const tm = timersRef.current.get(x.id);
            if (tm) clearTimeout(tm);
            timersRef.current.delete(x.id);
            continue;
          }
          next.push(x);
        }
        next.push(toast);
        return next;
      });

      // Best-effort sound (browser may block until user gesture)
      try {
        if (t.playSound) {
          if (toast.tone === "success" && audioOkRef.current) {
            audioOkRef.current.currentTime = 0;
            audioOkRef.current.play().catch(() => {});
          }
          if (toast.tone === "error" && audioErrRef.current) {
            audioErrRef.current.currentTime = 0;
            audioErrRef.current.play().catch(() => {});
          }
        }
      } catch {}

      // auto-dismiss
      if (toast.ttl > 0) {
        const tm = setTimeout(() => dismiss(id), toast.ttl);
        timersRef.current.set(id, tm);
      }

      return id;
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      toast: push,
      success: (msg, opts = {}) => push({ tone: "success", msg, ...opts }),
      error: (msg, opts = {}) => push({ tone: "error", msg, ...opts }),
      info: (msg, opts = {}) => push({ tone: "info", msg, ...opts }),
    }),
    [push],
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}

      {/* Toast stack */}
      <div className="fixed z-[9999] right-4 top-4 w-[min(420px,calc(100vw-2rem))] space-y-2">
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}

function ToastItem({ toast, onClose }) {
  const tone = toast.tone || "info";
  const styles = {
    info: "border-zinc-700 bg-zinc-950 text-zinc-100",
    success: "border-emerald-700 bg-emerald-950/40 text-emerald-100",
    error: "border-red-700 bg-red-950/40 text-red-100",
  };

  return (
    <div
      className={`rounded-xl border shadow-lg backdrop-blur px-4 py-3 transition-all duration-500 ${
        toast.closing ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"
      } ${styles[tone] || styles.info}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          {toast.title ? (
            <div className="text-sm font-semibold">{toast.title}</div>
          ) : null}
          <div className="text-sm">{toast.msg}</div>
        </div>
        <button
          onClick={onClose}
          className="text-xs opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
