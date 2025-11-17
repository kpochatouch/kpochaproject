// apps/api/sockets/index.js
// Socket.IO signaling + lightweight chat relay + feed events

import { Server } from "socket.io";
import redis from "../redis.js"; 
import admin from "firebase-admin";


// we will stash io here so routes can emit
let ioRef = null;
export function getIO() {
  return ioRef;
}

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
const profileRoom = (uid) => `profile:${String(uid)}`;
const userRoom = (uid) => `user:${String(uid)}`;
const postRoom = (postId) => `post:${String(postId)}`;

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

  // store for routes
  ioRef = io;

  io.on("connection", (socket) => {
    const uid = socket.handshake.auth?.uid || socket.handshake.query?.uid || null;

    // verify Firebase idToken or Authorization: Bearer <token> if provided; attach socket.data.uid
(async () => {
  try {
    // client may send the token in different places:
    //  - socket.handshake.auth.token
    //  - socket.handshake.auth.Authorization (or .authorization) as "Bearer <token>"
    //  - socket.handshake.query.token
    const authObj = socket.handshake?.auth || {};
    const provided =
      authObj.token ||
      authObj.Authorization ||
      authObj.authorization ||
      socket.handshake?.query?.token ||
      null;

    if (provided) {
      const raw = typeof provided === "string" && provided.startsWith("Bearer ")
        ? provided.slice(7).trim()
        : provided;

      try {
        const decoded = await admin.auth().verifyIdToken(raw);
        socket.data = socket.data || {};
        socket.data.uid = decoded.uid;
        socket.data.firebaseUser = decoded;
        socket.data.authenticated = true;
        console.log("[sockets] verified uid on connect:", decoded.uid);
      } catch (err) {
        // invalid token — fallback to hintedUid below
        console.warn("[sockets] token verify failed:", err?.message || err);
        socket.data = socket.data || {};
        socket.data.uid = hintedUid || null;
      }
    } else {
      socket.data = socket.data || {};
      socket.data.uid = hintedUid || null;
    }

    // join private user room if we have uid
    if (socket.data?.uid) {
      socket.join(userRoom(socket.data.uid));
    }
  } catch (e) {
    console.warn("[sockets] auth parse error:", e?.message || e);
    socket.data = socket.data || {};
    socket.data.uid = hintedUid || null;
    if (socket.data.uid) socket.join(userRoom(socket.data.uid));
  }
})();

    // --- Join room (keeps your name: room:join) ---
    socket.on("room:join", ({ room, who } = {}, cb) => {
      const r = roomName(room);
      if (!r) return cb?.({ ok: false, error: "room_required" });

      socket.join(r);
      socket.data.room = r;
      socket.data.who = who || uid || "anon";

      const peers = Array.from(io.sockets.adapter.rooms.get(r) || []).filter((id) => id !== socket.id);
      socket.to(r).emit("presence:join", {
        user: socket.data.who,
        id: socket.id,
        count: peers.length + 1,
      });
      cb?.({ ok: true, room: r, peers, count: peers.length + 1 });
    });

    // join by booking id
    socket.on("join:booking", ({ bookingId, who } = {}, cb) => {
      const id = bookingId != null ? String(bookingId) : "";
      if (!id) return cb?.({ ok: false, error: "bookingId_required" });
      const r = bookingRoom(id);

      socket.join(r);
      socket.data.room = r;
      socket.data.who = who || uid || "anon";

      const peers = Array.from(io.sockets.adapter.rooms.get(r) || []).filter((sid) => sid !== socket.id);
      socket.to(r).emit("presence:join", {
        user: socket.data.who,
        id: socket.id,
        count: peers.length + 1,
      });
      cb?.({ ok: true, room: r, peers, count: peers.length + 1 });
    });

    // Optional explicit leave
    socket.on("room:leave", ({ room } = {}, cb) => {
      const r = roomName(room) || socket.data.room;
      if (!r) return cb?.({ ok: false, error: "room_required" });
      socket.leave(r);
      socket.to(r).emit("presence:leave", {
        user: socket.data.who || uid || "anon",
        id: socket.id,
      });
      if (socket.data.room === r) delete socket.data.room;
      cb?.({ ok: true });
    });

    // --- Chat ---
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

    // --- WebRTC signaling ---
    ["webrtc:offer", "webrtc:answer", "webrtc:ice"].forEach((evt) => {
      socket.on(evt, ({ room, payload } = {}) => {
        const r = roomName(room) || socket.data.room;
        if (!r || payload == null) return;
        socket.to(r).emit(evt, { payload, from: socket.data.who || uid || socket.id });
      });
    });

    // Generic signaling
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

  // --- Redis pub/sub for cross-node events ---
  (async () => {
    if (!redis) {
      console.warn("[sockets] Redis not configured; skipping pub/sub subscription");
      return;
    }

    let sub = null;

    if (typeof redis.duplicate === "function") {
      sub = redis.duplicate();
      await sub.connect();
    } else {
      sub = redis;
    }

    const safeParse = (raw) => {
      try { return JSON.parse(raw); } catch { return null; }
    };

    // subscribe: post stats
    if (typeof sub.subscribe === "function") {
      await sub.subscribe("channel:post:stats", (raw) => {
        const p = safeParse(raw);
        if (!p?.postId) return;
        ioRef?.to(`post:${p.postId}`).emit("post:stats", p);
      });

      // subscribe: profile follow
      await sub.subscribe("channel:profile:follow", (raw) => {
        const p = safeParse(raw);
        if (!p?.targetUid) return;
        ioRef?.to(`profile:${p.targetUid}`).emit("profile:follow", p);
        ioRef?.to(`user:${p.targetUid}`).emit("notification:new", p);
      });

      console.log("[sockets] subscribed to Redis channels");
    }
  })();

  console.log("[sockets] ✅ Socket.IO attached (with feed events hook)");
  return io;
}
