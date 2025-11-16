import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { connectSocket, registerSocketHandler } from '../lib/api';

export default function LiveActivity({ ownerUid }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!ownerUid) return;
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get(`/api/activity/${encodeURIComponent(ownerUid)}?limit=20`);
        if (mounted) setItems(data.items || []);
      } catch (e) {}
    })();

    connectSocket();
    const unregister = registerSocketHandler
      ? registerSocketHandler('post:created', (payload) => {
          if (!payload || payload.proOwnerUid !== ownerUid) return;
          setItems((s)=>[{ kind: 'post', createdAt: payload.createdAt, payload }, ...s].slice(0,50));
        })
      : null;

    return () => { mounted = false; unregister && unregister(); };
  }, [ownerUid]);

  if (!ownerUid) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
      <h3 className="text-sm font-semibold mb-2">Live activity</h3>
      {items.length === 0 && <div className="text-sm text-zinc-400">No recent activity</div>}
      {items.slice(0,20).map((it, i) => (
        <div key={i} className="text-sm text-zinc-200 py-1 border-b border-zinc-800">
          <div className="text-xs text-zinc-400">{it.kind}</div>
          <div>{(it.payload && (it.payload.text || it.payload.body)) || JSON.stringify(it.payload).slice(0,80)}</div>
          <div className="text-xs text-zinc-500">{new Date(it.createdAt).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
