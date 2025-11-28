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
  const mounted = useRef(true);

  // Load initial notifications from backend
  useEffect(() => {
    mounted.current = true;

    (async () => {
      try {
        // listNotifications() already calls /api/notifications
        const list = await listNotifications({ limit: 50 });
        if (mounted.current) {
          // ensure array
          const arr = Array.isArray(list) ? list : [];
          setItems(arr);
        }

        const counts = await getNotificationsCounts();
        if (mounted.current) {
          setUnread(Number(counts?.unread || 0));
        }
      } catch (e) {
        console.warn("[useNotifications] init load failed:", e?.message || e);
      }
    })();

    return () => {
      mounted.current = false;
    };
  }, []);

  // Realtime notifications via sockets
  useEffect(() => {
    connectSocket(); // safe, idempotent

    // backend emits "notification:received"
    const off = registerSocketHandler("notification:received", (payload) => {
      if (!payload) return;

      setItems((prev) => [payload, ...prev].slice(0, 100));

      // if backend already marks it read, don't increment
      const alreadyRead = !!payload.read;
      if (!alreadyRead) {
        setUnread((u) => u + 1);
      }
    });

    return () => {
      off && off();
    };
  }, []);

  // Mark a single notification as read
  async function markRead(id) {
    if (!id) return;
    try {
      await apiMarkNotificationRead(id);
      setItems((s) =>
        s.map((it) => (it._id === id || it.id === id ? { ...it, read: true } : it))
      );
      setUnread((u) => Math.max(0, u - 1));
    } catch (e) {
      console.warn("[useNotifications] markRead failed:", e?.message || e);
    }
  }

  // Mark all notifications as read
  async function markAll() {
    try {
      await apiMarkAllNotificationsRead();
      setItems((s) => s.map((it) => ({ ...it, read: true })));
      setUnread(0);
    } catch (e) {
      console.warn("[useNotifications] markAll failed:", e?.message || e);
    }
  }

  return { items, unread, markRead, markAll, setItems };
}
