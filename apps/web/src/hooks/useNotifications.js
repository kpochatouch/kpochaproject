// apps/web/src/hooks/useNotifications.js
import { useEffect, useState, useRef, useCallback } from "react";
import {
  listNotifications,
  getNotificationsCounts,
  markNotificationRead as apiMarkNotificationRead,
  markAllNotificationsRead as apiMarkAllNotificationsRead,
  connectSocket,
  registerSocketHandler,
} from "../lib/api";

export default function useNotifications() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const mounted = useRef(false);

  const refreshCounts = useCallback(async () => {
    try {
      const counts = await getNotificationsCounts();
      if (mounted.current) {
        setUnread(Number(counts?.unread || 0));
      }
    } catch {}
  }, []);

  useEffect(() => {
    mounted.current = true;

    (async () => {
      try {
        const list = await listNotifications({ limit: 50 });
        const arr = Array.isArray(list?.items) ? list.items : Array.isArray(list) ? list : [];
        if (mounted.current) setItems(arr);
        await refreshCounts();
      } catch {}
    })();

    return () => {
      mounted.current = false;
    };
  }, [refreshCounts]);

  // 🔔 SOCKET: update list ONLY — never touch unread counter
  useEffect(() => {
    connectSocket();

    const handler = (payload) => {
      if (!payload) return;

      const id = payload.id || payload._id;
      if (!id) return;

      setItems((prev) => {
        if (prev.some((p) => String(p.id || p._id) === String(id))) {
          return prev;
        }
        return [payload, ...prev].slice(0, 100);
      });

      // ✅ backend is the source of truth
      refreshCounts();
    };

    const off1 = registerSocketHandler("notification:new", handler);
    const off2 = registerSocketHandler("notification:received", handler);

    return () => {
      off1?.();
      off2?.();
    };
  }, [refreshCounts]);

  async function markRead(id) {
    if (!id) return;
    try {
      await apiMarkNotificationRead(id);
      setItems((s) =>
        s.map((it) =>
          String(it.id || it._id) === String(id)
            ? { ...it, read: true, seen: true }
            : it
        )
      );
      refreshCounts();
    } catch {}
  }

  async function markAll() {
    try {
      await apiMarkAllNotificationsRead();
      setItems((s) => s.map((it) => ({ ...it, read: true, seen: true })));
      setUnread(0);
    } catch {}
  }

  return {
    items,
    unread,
    markRead,
    markAll,
    refreshCounts, // 🔥 expose this
  };
}
