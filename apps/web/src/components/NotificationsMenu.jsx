import React, { useState } from 'react';
import useNotifications from '../hooks/useNotifications';

export default function NotificationsMenu() {
  const { items, unread, markRead, markAll } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setOpen(o=>!o)} className="relative">
        Notifications {unread > 0 && <span className="ml-1 text-xs bg-red-600 text-white rounded-full px-2">{unread}</span>}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-auto rounded border bg-black p-2 z-50">
          <div className="flex justify-between items-center mb-2">
            <strong>Notifications</strong>
            <button onClick={() => markAll()} className="text-xs text-zinc-400">Mark all read</button>
          </div>
          {items.length === 0 && <div className="text-sm text-zinc-500">No notifications</div>}
          {items.map((n) => (
            <div key={n._id || n.id} className={`p-2 rounded mb-1 ${n.read ? 'opacity-60' : 'bg-zinc-900'}`}>
              <div className="text-sm font-medium">{n.title || n.type}</div>
              <div className="text-xs text-zinc-400">{n.body}</div>
              <div className="mt-1 flex gap-2">
                {!n.read && <button onClick={() => markRead(n._id || n.id)} className="text-xs">Mark read</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
