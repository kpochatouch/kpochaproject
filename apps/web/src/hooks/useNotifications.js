import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';

export default function useNotifications() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const res = await api.get('/api/notifications?limit=50');
        if (mounted.current) setItems(res.data || []);
        const cnt = await api.get('/api/notifications/counts').then(r=>r.data?.unread||0);
        if (mounted.current) setUnread(cnt);
      } catch (e) {
        // ignore
      }
    })();
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    // subscribe to socket notifications (api.js already wires socket in your project)
    try {
      if (window.__KPOCHA_SOCKET_REGISTER) {
        window.__KPOCHA_SOCKET_REGISTER((payload) => {
          if (!payload) return;
          setItems((s)=>[payload, ...s].slice(0,100));
          setUnread((u)=>u+1);
        });
      }
    } catch (e) {}
  }, []);

  async function markRead(id) {
    try {
      await api.put(`/api/notifications/${encodeURIComponent(id)}/read`);
      setItems((s)=>s.map(it=>it._id===id?{...it, read:true}:it));
      setUnread((u)=>Math.max(0,u-1));
    } catch (e) {}
  }

  async function markAll() {
    try {
      await api.put('/api/notifications/read-all');
      setItems((s)=>s.map(it=>({...it, read:true})));
      setUnread(0);
    } catch (e) {}
  }

  return { items, unread, markRead, markAll, setItems };
}
