// app/web/src/lib/socket.js
import { io } from "socket.io-client";

let socket = null;
let connected = false;
let handlers = new Map();

function getAuthHeader() {
  try {
    const t = localStorage.getItem("token");
    if (t) {
      const bearer = `Bearer ${t}`;
      // include multiple keys so server-side checks find something whichever key it expects
      return { token: bearer, Authorization: bearer, authorization: bearer };
    }
  } catch (e) {
    // ignore localStorage failures
  }
  return {};
}

export function connectSocket({
  url = (import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE_URL || "").replace(/\/api$/, ""),
} = {}) {
  if (connected && socket) return socket;
  try {
    const opts = {
      autoConnect: false,
      transports: ["websocket", "polling"],
      auth: () => getAuthHeader(),
    };
    socket = io(url || window.location.origin, opts);

    socket.on("connect", () => {
      connected = true;
      // console.log("[socket] connected", socket.id);
    });
    socket.on("disconnect", () => {
      connected = false;
      // console.log("[socket] disconnected");
    });

    // unified dispatcher using onAny — handle variable args safely
    socket.onAny((ev, ...args) => {
      const set = handlers.get(ev);
      const payload = args.length ? args[0] : undefined;
      if (set) {
        for (const fn of set) {
          try { fn(payload); } catch (e) { console.warn("[socket] handler failed", e); }
        }
      }
    });

    socket.connect();
  } catch (e) {
    console.warn("[socket] connect failed", e?.message || e);
  }
  return socket;
}

export function registerSocketHandler(event, fn) {
  if (!event || typeof fn !== "function") return () => {};
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
      socket.emit("room:join", { room: r }, (ack) => {
        // optional ack handling
      });
    }
  } catch (e) {
    console.warn("[socket] joinRooms failed", e?.message || e);
  }
}

export function disconnectSocket() {
  try {
    socket?.removeAllListeners();
    socket?.disconnect();
  } catch (e) {
    console.warn("[socket] disconnect failed", e?.message || e);
  }
  socket = null;
  connected = false;
}
