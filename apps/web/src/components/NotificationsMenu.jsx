// apps/web/src/components/NotificationsMenu.jsx
import React, { useState } from "react";
import useNotifications from "../hooks/useNotifications";

export default function NotificationsMenu() {
  const { items, unread, markRead, markAll } = useNotifications();
  const [open, setOpen] = useState(false);

  function toggle() {
    setOpen((o) => !o);
    // If opening the menu, automatically mark all as read
    if (!open && unread > 0) {
      markAll();
    }
  }

  return (
    <div className="relative">
      <button onClick={toggle} className="relative">
        Notifications{" "}
        {unread > 0 && (
          <span className="ml-1 text-xs bg-red-600 text-white rounded-full px-2">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-auto rounded border border-zinc-800 bg-black p-2 z-50">
          <div className="flex justify-between items-center mb-2">
            <strong className="text-sm">Notifications</strong>
            <button onClick={markAll} className="text-xs text-zinc-400">
              Mark all read
            </button>
          </div>

          {items.length === 0 && (
            <div className="text-sm text-zinc-500">No notifications</div>
          )}

          {items.map((n) => (
            <div
              key={n._id || n.id}
              className={`p-2 rounded mb-1 ${
                n.read ? "opacity-60" : "bg-zinc-900/40"
              }`}
            >
              <div className="text-sm font-semibold">
                {n.title || n.type || "Notification"}
              </div>
              <div className="text-xs text-zinc-400">{n.body}</div>
              <div className="text-[10px] text-zinc-500 mt-1">
                {new Date(n.createdAt).toLocaleString()}
              </div>

              {!n.read && (
                <button
                  onClick={() => markRead(n._id || n.id)}
                  className="text-[10px] mt-1 text-blue-400"
                >
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
