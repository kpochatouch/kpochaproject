// apps/api/sockets/index.js
// Socket.IO signaling + lightweight chat relay (multi-peer friendly)
// server.js attaches like:
//   const server = http.createServer(app);
//   attachSockets(server);

import { Server } from "socket.io";

// ---- CORS mirror (aligned with server.js) ----
function buildOriginChecker() {
  const allowList = String(process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const allowVercel = (process.env.ALLOW_VERCEL_PREVIEWS || "true") !== "false";

  return function originAllowed(origin) {
    if (!origin) return true; // same-origin / non-browser
    try {
      const oh = new URL(origin).host;
      for (const o of allowList) {
        try {
          if (new URL(o).host === oh) return true;
          if (o === origin) return true;
        } catch {}
      }
      if (allowVercel && oh.endsWith(".vercel.app")) return true;
    } catch {}
    return false;
  };
}

// ---- Helpers ----
const roomName = (r) => (r && typeof r === "string" ? r : "");
const bookingRoom = (id) => `booking:${id}`;

export default function attachSockets(httpServer) {
  const originAllowed = buildOriginChecker();

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, cb) =>
        originAllowed(origin) ? cb(null, true) : cb(new Error("Socket.IO CORS blocked")),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    },
    path: "/socket.io",
    serveClient: false,
    pingTimeout: 25000,
    pingInterval: 20000,
  });

  io.on("connection", (socket) => {
    const uid = socket.handshake.auth?.uid || socket.handshake.query?.uid || null;

    // --- Join room (keeps your name: room:join) ---
    socket.on("room:join", ({ room, who } = {}, cb) => {
      const r = roomName(room);
      if (!r) return cb?.({ ok: false, error: "room_required" });

      socket.join(r);
      socket.data.room = r;
      socket.data.who = who || uid || "anon";

      const peers = Array.from(io.sockets.adapter.rooms.get(r) || []).filter((id) => id !== socket.id);
      socket.to(r).emit("presence:join", { user: socket.data.who, id: socket.id, count: peers.length + 1 });
      cb?.({ ok: true, room: r, peers, count: peers.length + 1 });
    });

    // Convenience: join by booking id
    socket.on("join:booking", ({ bookingId, who } = {}, cb) => {
      const id = bookingId != null ? String(bookingId) : "";
      if (!id) return cb?.({ ok: false, error: "bookingId_required" });
      const r = bookingRoom(id);

      socket.join(r);
      socket.data.room = r;
      socket.data.who = who || uid || "anon";

      const peers = Array.from(io.sockets.adapter.rooms.get(r) || []).filter((sid) => sid !== socket.id);
      socket.to(r).emit("presence:join", { user: socket.data.who, id: socket.id, count: peers.length + 1 });
      cb?.({ ok: true, room: r, peers, count: peers.length + 1 });
    });

    // Optional explicit leave
    socket.on("room:leave", ({ room } = {}, cb) => {
      const r = roomName(room) || socket.data.room;
      if (!r) return cb?.({ ok: false, error: "room_required" });
      socket.leave(r);
      socket.to(r).emit("presence:leave", { user: socket.data.who || uid || "anon", id: socket.id });
      if (socket.data.room === r) delete socket.data.room;
      cb?.({ ok: true });
    });

    // --- Chat (name preserved) ---
    socket.on("chat:message", (msg = {}) => {
      const r = roomName(msg?.room) || socket.data.room;
      const text = msg?.text ?? msg?.message ?? msg?.body;
      if (!r || !text) return;
      socket.to(r).emit("chat:message", {
        room: r,
        text,
        from: socket.data.who || uid || socket.id,
        at: msg?.at || Date.now(),
        meta: msg?.meta || {},
      });
    });

    // --- WebRTC signaling (names preserved, no self-echo) ---
    ["webrtc:offer", "webrtc:answer", "webrtc:ice"].forEach((evt) => {
      socket.on(evt, ({ room, payload } = {}) => {
        const r = roomName(room) || socket.data.room;
        if (!r || payload == null) return;
        socket.to(r).emit(evt, { payload, from: socket.data.who || uid || socket.id });
      });
    });

    // Optional generic signaling
    socket.on("signal", ({ room, type, data } = {}) => {
      const r = roomName(room) || socket.data.room;
      if (!r || !type) return;
      socket.to(r).emit("signal", { type, data, from: socket.data.who || uid || socket.id });
    });

    // --- Presence on disconnect ---
    socket.on("disconnecting", () => {
      const rooms = [...socket.rooms].filter((r) => r !== socket.id);
      rooms.forEach((r) =>
        socket
          .to(r)
          .emit("presence:leave", { user: socket.data.who || uid || "anon", id: socket.id, reason: "disconnect" })
      );
    });
  });

  io.engine.on("connection_error", (err) => {
    console.warn("[sockets] connection_error:", err.code, err.message);
  });

  console.log("[sockets] ✅ Socket.IO attached");
  return io;
}
