// apps/web/src/components/NotificationBell.jsx
import React, { useEffect, useState } from "react";
import { connectSocket, registerSocketHandler } from "../lib/socket";
import { fetchNotifications, markNotificationSeen, markAllSeen } from "../lib/notifications";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await fetchNotifications({ unreadOnly: false, limit: 30 });
        if (!alive) return;
        setItems(list);
        setUnread(list.filter((it) => !it.seen).length);
      } catch (e) {
        console.warn("fetch notifications", e);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    connectSocket(); // idempotent

    const offNotif = registerSocketHandler("notification", (payload) => {
      // server should emit { ownerUid, type, data, createdAt, _id }
      setItems((prev) => [payload, ...prev]);
      setUnread((n) => n + 1);
    });

    const offProfileStats = registerSocketHandler("profile:stats", (p) => {
      // optionally update UI counters here or bubble up via context
      // ignore in bell
    });

    return () => {
      offNotif && offNotif();
      offProfileStats && offProfileStats();
    };
  }, []);

  async function handleOpen() {
    setOpen((v) => !v);
    if (!open && unread > 0) {
      // mark all seen quickly
      try {
        await markAllSeen();
        setItems((it) => it.map((i) => ({ ...i, seen: true })));
        setUnread(0);
      } catch (e) { console.warn(e); }
    }
  }

  return (
    <div className="relative">
      <button onClick={handleOpen} className="relative">
        🔔
        {unread > 0 && <span className="absolute -top-1 -right-1 text-xs bg-red-600 rounded-full px-1 py-0.5">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 max-h-80 overflow-auto bg-black border border-zinc-800 rounded-lg p-2">
          {items.length === 0 ? <div className="text-xs text-zinc-500">No notifications</div> :
            items.map((n) => (
              <div key={n._id || n.id} className={`p-2 rounded ${n.seen ? "opacity-80" : "bg-zinc-900/40"}`}>
                <div className="text-sm">{n.type}</div>
                <div className="text-xs text-zinc-400">{n.data?.text || JSON.stringify(n.data)}</div>
                <div className="text-[10px] text-zinc-500 mt-1">{new Date(n.createdAt).toLocaleString()}</div>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}
