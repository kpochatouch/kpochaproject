//apps/web/src/components/NotificationBell.jsx
import React, { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import useNotifications from "../hooks/useNotifications";
import {
  presentNotification,
  getNotificationAvatar,
  formatNotificationTime,
} from "../lib/notificationPresentation";

export default function NotificationBell() {
  const navigate = useNavigate();
  const { items, unread, markRead, markAll, deleteItem } = useNotifications();

  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  useEffect(() => {
    function onGlobalClick(e) {
      const target = e?.detail?.target;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    }

    window.addEventListener("global-click", onGlobalClick);
    return () => window.removeEventListener("global-click", onGlobalClick);
  }, []);

  const enhanced = useMemo(
    () =>
      items.map((n) => {
        const view = presentNotification(n);
        return {
          ...view,
          id: n._id || n.id,
          seen: n.seen,
          createdAt: n.createdAt,
          avatar: getNotificationAvatar(n),
          raw: n,
        };
      }),
    [items],
  );

  async function handleClick(entry) {
    try {
      if (!entry.seen && entry.id) {
        await markRead(entry.id);
      }
    } catch {}

    setOpen(false);
    if (entry.target) navigate(entry.target);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (isMobile) {
            navigate("/notifications");
            return;
          }
          setOpen((o) => !o);
        }}
        aria-label="Notifications"
        className="relative inline-flex items-center justify-center
                   w-9 h-9 rounded-full border border-zinc-800
                   bg-black/40 hover:bg-zinc-900 transition"
      >
        🔔
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px]
                       px-1.5 py-0.5 text-[10px]
                       rounded-full bg-red-600 text-white font-semibold"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="
          absolute mt-2
          left-1/2 -translate-x-1/2
          w-[92vw] max-w-sm
          max-h-[70vh] overflow-y-auto
          bg-black border border-zinc-800 rounded-xl
          shadow-xl z-40
        "
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="text-xs font-semibold text-zinc-300">
              Notifications
            </span>

            {enhanced.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await markAll();
                  } catch {}
                }}
                className="text-xs text-gold hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {enhanced.length === 0 ? (
            <div className="p-4 text-xs text-zinc-500 text-center">
              No notifications yet
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800 overscroll-contain">
              {enhanced.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className={`w-full text-left p-3 transition
                      ${n.seen ? "bg-black" : "bg-zinc-900/60"}
                      hover:bg-zinc-800`}
                  >
                    <div className="flex items-start gap-3">
                      {n.avatar ? (
                        <img
                          src={n.avatar}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="text-lg">{n.icon}</div>
                      )}

                      <div className="flex-1">
                        <div className="text-[12px] font-semibold">
                          {n.title}
                        </div>

                        {n.body && (
                          <div className="text-[11px] text-zinc-300 mt-0.5">
                            {n.body}
                          </div>
                        )}

                        <div className="text-[10px] text-zinc-500 mt-1">
                          {formatNotificationTime(n.createdAt)}
                        </div>
                      </div>
                    </div>
                  </button>

                  <div className="px-3 pb-2 flex items-center gap-2 text-[10px]">
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await markRead(n.id);
                        } catch {}
                      }}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      Mark read
                    </button>
                    <span className="text-zinc-600">•</span>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await deleteItem(n.id);
                        } catch {}
                      }}
                      className="text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
