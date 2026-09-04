// apps/web/src/hooks/useNotifications.js
import { useEffect, useState, useRef, useCallback } from "react";
import {
  listNotifications,
  getNotificationsCounts,
  markNotificationRead as apiMarkNotificationRead,
  deleteNotification as apiDeleteNotification,
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
        const arr = Array.isArray(list?.items)
          ? list.items
          : Array.isArray(list)
          ? list
          : [];
        if (mounted.current) setItems(arr);
        await refreshCounts();
      } catch {}
    })();

    return () => {
      mounted.current = false;
    };
  }, [refreshCounts]);

  // Installed Chromium PWAs can display this number on the home-screen icon.
  // Unsupported browsers simply ignore it and continue showing the in-app bell.
  useEffect(() => {
    const nav = navigator;
    if (typeof nav.setAppBadge !== "function") return;
    if (unread > 0) {
      nav.setAppBadge(unread).catch(() => {});
    } else {
      nav.clearAppBadge?.().catch(() => {});
    }
  }, [unread]);

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
      if (Number.isFinite(Number(payload.unreadCount))) {
        setUnread(Number(payload.unreadCount));
      } else {
        refreshCounts();
      }
    };

    const onRead = ({ id } = {}) => {
      if (!id) return;
      setItems((prev) =>
        prev.map((item) =>
          String(item.id || item._id) === String(id)
            ? { ...item, seen: true, read: true }
            : item,
        ),
      );
      refreshCounts();
    };
    const onAllRead = () => {
      setItems((prev) =>
        prev.map((item) => ({ ...item, seen: true, read: true })),
      );
      refreshCounts();
    };
    const onDeleted = ({ id } = {}) => {
      if (!id) return;
      setItems((prev) =>
        prev.filter((item) => String(item.id || item._id) !== String(id)),
      );
      refreshCounts();
    };

    const offReceived = registerSocketHandler("notification:received", handler);
    const offRead = registerSocketHandler("notification:read", onRead);
    const offAllRead = registerSocketHandler("notification:all_read", onAllRead);
    const offDeleted = registerSocketHandler("notification:deleted", onDeleted);

    return () => {
      offReceived?.();
      offRead?.();
      offAllRead?.();
      offDeleted?.();
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
            : it,
        ),
      );
      refreshCounts();
    } catch {}
  }

  async function deleteItem(id) {
    if (!id) return;
    try {
      await apiDeleteNotification(id);
      setItems((prev) =>
        prev.filter((it) => String(it.id || it._id) !== String(id)),
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
    deleteItem,
    markAll,
    refreshCounts, // 🔥 expose this
  };
}
