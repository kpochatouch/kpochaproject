// apps/web/src/components/NotificationBell.jsx
import React, { useState } from "react";
import useNotifications from "../hooks/useNotifications";

export default function NotificationBell() {
  const { items, unread, markAll } = useNotifications();
  const [open, setOpen] = useState(false);

  async function handleToggle() {
    const willOpen = !open;
    setOpen(willOpen);

    // When opening and we have unread, mark all as read
    if (willOpen && unread > 0) {
      try {
        await markAll();
      } catch (e) {
        console.warn("[NotificationBell] markAll failed:", e?.message || e);
      }
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        type="button"
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-full border border-zinc-800 bg-black/40 hover:bg-zinc-900 transition"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 text-[10px] bg-red-600 text-white rounded-full px-1.5 py-0.5 leading-none font-semibold">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-80 overflow-auto bg-black border border-zinc-800 rounded-xl p-2 shadow-lg z-40">
          {items.length === 0 ? (
            <div className="text-xs text-zinc-500 px-2 py-3 text-center">
              No notifications yet.
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((n) => {
                const id = n._id || n.id;
                const createdAt = n.createdAt ? new Date(n.createdAt) : null;
                const timeText = createdAt
                  ? createdAt.toLocaleString()
                  : "";

                return (
                  <div
                    key={id}
                    className={`p-2 rounded-md text-xs ${
                      n.read ? "opacity-80" : "bg-zinc-900/40"
                    }`}
                  >
                    {n.title && (
                      <div className="text-[11px] font-semibold mb-0.5">
                        {n.title}
                      </div>
                    )}
                    {n.body && (
                      <div className="text-[11px] text-zinc-300">
                        {n.body}
                      </div>
                    )}
                    {timeText && (
                      <div className="text-[10px] text-zinc-500 mt-1">
                        {timeText}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
