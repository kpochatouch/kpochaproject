// apps/api/sockets/index.js
// Socket.IO signaling + lightweight chat relay (compatible with your SignalingClient.js)
// server.js attaches like:
//   const server = http.createServer(app);
//   attachSockets(server);

import { Server } from "socket.io";

// Mirror server.js CORS logic so sockets succeed wherever REST succeeds
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

  const roomName = (r) => (r && typeof r === "string" ? r : "");
  const bookingRoom = (id) => `booking:${id}`;

  io.on("connection", (socket) => {
    // Optional identity hint (not sent back in events to keep client payload shape unchanged)
    const uid = socket.handshake.auth?.uid || socket.handshake.query?.uid || null;

    // --- Room join (keeps your name) ---
    socket.on("room:join", ({ room, who } = {}, cb) => {
      const r = roomName(room);
      if (!r) return cb?.({ ok: false, error: "room_required" });
      socket.join(r);
      socket.data.room = r;
      socket.data.who = who || uid || "anon";
      // (Presence is optional; harmless if unused)
      socket.to(r).emit("presence:join", { id: socket.id });
      const peers = Array.from(io.sockets.adapter.rooms.get(r) || []).filter((id) => id !== socket.id);
      cb?.({ ok: true, room: r, peers });
    });

    // Convenience: join by booking id
    socket.on("join:booking", ({ bookingId, who } = {}, cb) => {
      const id = bookingId != null ? String(bookingId) : "";
      if (!id) return cb?.({ ok: false, error: "bookingId_required" });
      const r = bookingRoom(id);
      socket.join(r);
      socket.data.room = r;
      socket.data.who = who || uid || "anon";
      socket.to(r).emit("presence:join", { id: socket.id });
      const peers = Array.from(io.sockets.adapter.rooms.get(r) || []).filter((sid) => sid !== socket.id);
      cb?.({ ok: true, room: r, peers });
    });

    // Optional explicit leave
    socket.on("room:leave", ({ room } = {}, cb) => {
      const r = roomName(room) || socket.data.room;
      if (!r) return cb?.({ ok: false, error: "room_required" });
      socket.leave(r);
      socket.to(r).emit("presence:leave", { id: socket.id });
      if (socket.data.room === r) delete socket.data.room;
      cb?.({ ok: true });
    });

    // --- Chat (name preserved). No self-echo. Payload relayed as-is. ---
    socket.on("chat:message", (msg = {}) => {
      const r = roomName(msg?.room) || socket.data.room;
      if (!r) return;
      socket.to(r).emit("chat:message", msg);
    });

    // --- WebRTC signaling (names preserved). No self-echo. Emit raw payload only. ---
    ["webrtc:offer", "webrtc:answer", "webrtc:ice"].forEach((evt) => {
      socket.on(evt, ({ room, payload } = {}) => {
        const r = roomName(room) || socket.data.room;
        if (!r || payload == null) return;
        // IMPORTANT for your SignalingClient.js: forward the raw payload only
        socket.to(r).emit(evt, payload);
      });
    });

    // Optional generic signaling if ever needed (not used by your client now)
    socket.on("signal", ({ room, type, data } = {}) => {
      const r = roomName(room) || socket.data.room;
      if (!r || !type) return;
      // Keep generic signals raw-consistent too: emit {type,data} only if you’ll consume it that way.
      socket.to(r).emit("signal", { type, data });
    });

    // Presence on disconnect
    socket.on("disconnecting", () => {
      const rooms = [...socket.rooms].filter((r) => r !== socket.id);
      rooms.forEach((r) => socket.to(r).emit("presence:leave", { id: socket.id, reason: "disconnect" }));
    });
  });

  io.engine.on("connection_error", (err) => {
    console.warn("[sockets] connection_error:", err.code, err.message);
  });

  console.log("[sockets] ✅ Socket.IO attached");
  return io;
}
