// apps/web/src/hooks/useSocket.js
import { useEffect, useRef } from "react";
import { registerSocketHandler } from "../lib/api";

/**
 * SAFE useSocket
 *
 *
 *
 * - ONLY manages handlers for this component.
 * - Does NOT call connectSocket()
 * - Does NOT call disconnectSocket()
 *
 * Socket connection lifecycle stays fully owned by api.js.
 */
export default function useSocket(initialHandlers = {}) {
  const unregistersRef = useRef(new Set());

  useEffect(() => {
    // register initial handlers
    try {
      for (const [evt, fn] of Object.entries(initialHandlers || {})) {
        if (typeof fn === "function") {
          const off = registerSocketHandler(evt, fn);
          if (typeof off === "function") {
            unregistersRef.current.add(off);
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
          try {
            off();
          } catch {}
        }
      } finally {
        unregistersRef.current.clear();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

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

  // No close() that disconnects global socket.
  return { addHandler, removeHandler };
}
