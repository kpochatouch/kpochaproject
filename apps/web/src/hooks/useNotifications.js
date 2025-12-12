// apps/web/src/hooks/useNotifications.js
import { useEffect, useState, useRef } from "react";
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

  useEffect(() => {
    mounted.current = true;

    (async () => {
      try {
        const list = await listNotifications({ limit: 50 });
        const arr = Array.isArray(list) ? list : Array.isArray(list?.items) ? list.items : [];
        if (mounted.current) setItems(arr);

        const counts = await getNotificationsCounts();
        if (mounted.current) setUnread(Number(counts?.unread || 0));
      } catch (e) {
        console.warn("[useNotifications] init load failed:", e?.message || e);
      }
    })();

    return () => {
      mounted.current = false;
    };
  }, []);

  // Realtime notifications via sockets.
  // Accept both 'notification:new' and 'notification:received' server events.
  // apps/web/src/hooks/useNotifications.js
useEffect(() => {
  connectSocket();

  const handler = (payload) => {
    if (!payload) return;

    const id =
      payload.id ||
      payload._id ||
      (payload.data && payload.data.id) ||
      null;
    const normalized = { id, ...payload };

    setItems((prev) => {
      if (id && prev.some((p) => String(p.id || p._id) === String(id))) {
        return prev.map((p) =>
          String(p.id || p._id) === String(id) ? { ...p, ...normalized } : p
        );
      }
      return [normalized, ...prev].slice(0, 200);
    });

    const alreadyRead = !!payload.read || !!payload.seen;
    if (!alreadyRead) {
      setUnread((u) => u + 1);
    }
  };

  const off = registerSocketHandler("notification:received", handler);

  return () => {
    try {
      off && off();
    } catch {}
  };
}, []);


  async function markRead(id) {
    if (!id) return;
    try {
      await apiMarkNotificationRead(id);
      setItems((s) =>
        s.map((it) =>
          String(it.id || it._id) === String(id) ? { ...it, read: true, seen: true } : it
        )
      );
      setUnread((u) => Math.max(0, u - 1));
    } catch (e) {
      console.warn("[useNotifications] markRead failed:", e?.message || e);
    }
  }

  async function markAll() {
    try {
      await apiMarkAllNotificationsRead();
      setItems((s) => s.map((it) => ({ ...it, read: true, seen: true })));
      setUnread(0);
    } catch (e) {
      console.warn("[useNotifications] markAll failed:", e?.message || e);
    }
  }

  return { items, unread, markRead, markAll, setItems };
}
