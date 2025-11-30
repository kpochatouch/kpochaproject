// apps/web/src/hooks/useSocket.js
import { useEffect, useRef } from "react";
import { connectSocket, disconnectSocket, registerSocketHandler } from "../lib/api";

/**
 * useSocket(initialHandlers = {}, options = { autoConnect: true })
 *
 * - initialHandlers: { "event:name": fn, ... } handlers to register on mount
 * - returns:
 *    - addHandler(event, fn) -> unregisterFn
 *    - removeHandler(unregisterFn) -> void
 *    - close() -> disconnect socket (cleans up all handlers)
 *
 * This hook simply ensures handlers are registered and unregistered when the
 * component mounts/unmounts. It relies on your api.connectSocket()/registerSocketHandler().
 */
export default function useSocket(initialHandlers = {}, options = { autoConnect: true }) {
  const unregistersRef = useRef(new Set());

  useEffect(() => {
    if (options?.autoConnect !== false) {
      connectSocket();
    }

    // register initial handlers
    const created = [];
    try {
      for (const [evt, fn] of Object.entries(initialHandlers || {})) {
        if (typeof fn === "function") {
          const off = registerSocketHandler(evt, fn);
          if (typeof off === "function") {
            unregistersRef.current.add(off);
            created.push(off);
          }
        }
      }
    } catch (e) {
      console.warn("[useSocket] initial register failed:", e?.message || e);
    }

    return () => {
      // cleanup registered handlers
      try {
        for (const off of Array.from(unregistersRef.current)) {
          try { off(); } catch {}
        }
      } finally {
        unregistersRef.current.clear();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addHandler(event, fn) {
    if (!event || typeof fn !== "function") return () => {};
    const off = registerSocketHandler(event, fn);
    if (typeof off === "function") unregistersRef.current.add(off);
    return off;
  }

  function removeHandler(unregisterFn) {
    try {
      if (typeof unregisterFn === "function") {
        unregisterFn();
        unregistersRef.current.delete(unregisterFn);
      }
    } catch {}
  }

  function close() {
    try {
      for (const off of Array.from(unregistersRef.current)) {
        try { off(); } catch {}
      }
      unregistersRef.current.clear();
      disconnectSocket();
    } catch (e) {
      console.warn("[useSocket] close failed:", e?.message || e);
    }
  }

  return { addHandler, removeHandler, close };
}
