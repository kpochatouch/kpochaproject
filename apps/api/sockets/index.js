// apps/api/sockets/index.js
// Socket.IO signaling + lightweight chat relay
// In server.js we conditionally attach this file:
//   import http from "http";
//   import attachSockets from "./sockets/index.js";
//   const server = http.createServer(app);
//   attachSockets(server);
//   server.listen(PORT, ...);

import { Server } from "socket.io";

export default function attachSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: (origin, cb) => cb(null, true) },
    path: "/socket.io",
  });

  io.on("connection", (socket) => {
    socket.on("room:join", ({ room, who }) => {
      if (!room) return;
      socket.join(room);
      socket.data.room = room;
      socket.data.who = who || "anon";
    });

    // Chat
    socket.on("chat:message", (msg) => {
      const room = msg?.room || socket.data.room;
      if (!room) return;
      socket.to(room).emit("chat:message", msg);
    });

    // WebRTC signaling relay
    ["webrtc:offer", "webrtc:answer", "webrtc:ice"].forEach((evt) => {
      socket.on(evt, ({ room, payload }) => {
        const r = room || socket.data.room;
        if (!r) return;
        io.to(r).emit(evt, payload);
      });
    });
  });

  console.log("[sockets] ✅ Socket.IO attached");
  return io;
}
