import { useEffect, useState, useRef } from "react";
import { api } from "../lib/api";
import { connectSocket, registerSocketHandler } from "../lib/socket";

export default function useNotifications() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const mounted = useRef(true);

  // Load initial notifications from backend
  useEffect(() => {
    mounted.current = true;

    (async () => {
      try {
        const listRes = await api.get("/api/notifications?limit=50");
        if (mounted.current) setItems(listRes.data || []);

        const countRes = await api.get("/api/notifications/counts");
        if (mounted.current) setUnread(countRes.data?.unread || 0);
      } catch (e) {
        console.warn("notifications init load", e);
      }
    })();

    return () => {
      mounted.current = false;
    };
  }, []);

  // Realtime notifications via sockets
  useEffect(() => {
    connectSocket(); // safe, idempotent

    // Listen for backend event: "notification:received"
    const off = registerSocketHandler("notification:received", (payload) => {
      if (!payload) return;

      setItems((prev) => [payload, ...prev].slice(0, 100));
      setUnread((u) => u + 1);
    });

    return () => {
      off && off();
    };
  }, []);

  // Mark a single notification as read
  async function markRead(id) {
    try {
      await api.put(`/api/notifications/${encodeURIComponent(id)}/read`);
      setItems((s) => s.map((it) => (it._id === id ? { ...it, read: true } : it)));
      setUnread((u) => Math.max(0, u - 1));
    } catch (e) {}
  }

  // Mark all notifications as read
  async function markAll() {
    try {
      await api.put("/api/notifications/read-all");
      setItems((s) => s.map((it) => ({ ...it, read: true })));
      setUnread(0);
    } catch (e) {}
  }

  return { items, unread, markRead, markAll, setItems };
}
