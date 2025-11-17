import { io } from 'socket.io-client';

let socket = null;
let connected = false;
let handlers = new Map();

function getAuthHeader() {
  try {
    const t = localStorage.getItem('token');
    if (t) return { token: `Bearer ${t}` };

  } catch {}
  return {};
}

export function connectSocket({ url = (import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE_URL || '').replace(/\/api$/, '') } = {}) {
  if (connected && socket) return socket;
  try {
    const opts = {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: () => getAuthHeader(),
    };
    socket = io(url || window.location.origin, opts);

    socket.on('connect', () => { connected = true; });
    socket.on('disconnect', () => { connected = false; });

    socket.onAny((ev, payload) => {
      const set = handlers.get(ev);
      if (set) for (const fn of set) { try { fn(payload); } catch (e) {} }
    });

    socket.connect();
  } catch (e) {
    console.warn('[socket] connect failed', e?.message || e);
  }
  return socket;
}

export function registerSocketHandler(event, fn) {
  if (!event || typeof fn !== 'function') return () => {};
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(fn);
  if (!connected) connectSocket();
  return () => {
    try {
      handlers.get(event)?.delete(fn);
    } catch {}
  };
}

export function joinRooms(rooms = []) {
  try {
    if (!socket) connectSocket();
    if (!Array.isArray(rooms)) rooms = [rooms];
    for (const r of rooms) {
      // server listens for 'room:join'
      socket.emit('room:join', { room: r }, (ack) => {
        // optional ack handling — ignore for now
      });
    }
  } catch (e) {}
}


export function disconnectSocket() {
  try {
    socket?.removeAllListeners();
    socket?.disconnect();
  } catch {}
  socket = null;
  connected = false;
}
