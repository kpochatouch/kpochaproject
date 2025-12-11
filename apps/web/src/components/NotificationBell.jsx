// apps/web/src/components/NotificationBell.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useNotifications from "../hooks/useNotifications";

export default function NotificationBell() {
  const { items, unread, markAll, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const navigate = useNavigate();

  // ✅ FIX: toggling the bell ONLY opens/closes – no auto markAll
  function handleToggle() {
    setOpen((prev) => !prev);
  }

  // clicking a single notification → mark THAT one as read + deep link
  async function handleNotificationClick(n) {
    const id = n._id || n.id;
    const type = n.type;
    const data = n.data || {};

    if (id) {
      try {
        await markRead(id);
      } catch (e) {
        console.warn("[NotificationBell] markRead failed:", e?.message || e);
      }
    }

    setOpen(false);

    // Deep link rules (adjust as your data model grows)
    if (type === "chat_message" && data.peerUid) {
      navigate(`/chat?with=${encodeURIComponent(data.peerUid)}`);
    } else if (type === "booking_update" && data.bookingId) {
      navigate(`/bookings/${encodeURIComponent(data.bookingId)}`);
    } else if ((type === "call_missed" || type === "call") && data.peerUid) {
      navigate(`/chat?with=${encodeURIComponent(data.peerUid)}&call=audio`);
    }
  }

  // click outside → close dropdown
  useEffect(() => {
    function handleGlobalClick(evt) {
      if (!rootRef.current) return;
      const originalEvent = evt.detail;
      const target = originalEvent?.target;
      if (!target) return;
      if (rootRef.current.contains(target)) return;
      setOpen(false);
    }

    window.addEventListener("global-click", handleGlobalClick);
    return () => window.removeEventListener("global-click", handleGlobalClick);
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={handleToggle}
        type="button"
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-full border border-zinc-800 bg-black/40 hover:bg-zinc-900 transition"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 text-[10px] bg-red-600 text-white rounded-full px-1.5 py-0.5 leading-none font-semibold">
            {unread > 9 ? "9+" : unread}
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
            <>
              <div className="space-y-1">
                {items.map((n) => {
                  const id = n._id || n.id;
                  const createdAt = n.createdAt ? new Date(n.createdAt) : null;
                  const timeText = createdAt ? createdAt.toLocaleString() : "";

                  const title =
                    n.data?.title ||
                    n.title ||
                    n.type ||
                    (n.meta && n.meta.label) ||
                    "Notification";

                  const body =
                    n.data?.body ||
                    n.body ||
                    (n.meta &&
                      (n.meta.preview ||
                        n.meta.message ||
                        n.meta.text)) ||
                    n.message;

                  const isRead = !!(n.read || n.seen);

                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleNotificationClick(n)}
                      className={`w-full text-left p-2 rounded-md text-xs ${
                        isRead ? "opacity-80" : "bg-zinc-900/40"
                      } hover:bg-zinc-800/70 transition`}
                    >
                      <div className="text-[11px] font-semibold mb-0.5">
                        {title}
                      </div>
                      {body && (
                        <div className="text-[11px] text-zinc-300">
                          {body}
                        </div>
                      )}
                      {timeText && (
                        <div className="text-[10px] text-zinc-500 mt-1">
                          {timeText}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* optional: explicit "Mark all read" button at bottom */}
              {unread > 0 && (
                <div className="mt-2 pt-2 border-t border-zinc-800 text-right">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await markAll();
                      } catch (e) {
                        console.warn(
                          "[NotificationBell] markAll failed:",
                          e?.message || e
                        );
                      }
                    }}
                    className="text-[11px] text-zinc-400 hover:text-zinc-100"
                  >
                    Mark all as read
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
