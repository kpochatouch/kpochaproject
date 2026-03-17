//apps/web/src/pages/Notifications.jsx
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import useNotifications from "../hooks/useNotifications";
import MobileBackButton from "../components/MobileBackButton";
import RouteLoader from "../components/RouteLoader.jsx";
import {
  presentNotification,
  getNotificationAvatar,
  formatNotificationTime,
} from "../lib/notificationPresentation";

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { items, markRead, markAll, loading } = useNotifications();

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

  async function handleOpen(entry) {
    try {
      if (!entry.seen && entry.id) {
        await markRead(entry.id);
      }
    } catch {}

    if (entry.target) {
      navigate(entry.target);
    }
  }

  if (loading) {
    return <RouteLoader full />;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <MobileBackButton fallback="/" />
          <div>
            <h1 className="text-2xl font-semibold">Notifications</h1>
            <p className="text-xs text-zinc-500">
              Your activity, messages, calls and updates.
            </p>
          </div>
        </div>

        {enhanced.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              try {
                await markAll();
              } catch {}
            }}
            className="text-xs px-3 py-2 rounded-lg border border-zinc-800"
          >
            Mark all read
          </button>
        )}
      </div>

      {enhanced.length === 0 ? (
        <div className="border border-zinc-800 rounded-xl bg-black/40 px-4 py-10 text-center text-sm text-zinc-400">
          No notifications yet
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded-xl overflow-hidden">
          {enhanced.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => handleOpen(n)}
                className={`w-full text-left p-4 transition ${
                  n.seen ? "bg-black" : "bg-zinc-900/60"
                } hover:bg-zinc-800`}
              >
                <div className="flex items-start gap-3">
                  {n.avatar ? (
                    <img
                      src={n.avatar}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="text-xl leading-none mt-1">{n.icon}</div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{n.title}</div>

                    {n.body && (
                      <div className="text-xs text-zinc-300 mt-0.5">
                        {n.body}
                      </div>
                    )}

                    <div className="text-[11px] text-zinc-500 mt-1">
                      {formatNotificationTime(n.createdAt)}
                    </div>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
