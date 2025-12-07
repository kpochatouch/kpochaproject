// apps/api/sockets/index.js
// Full Socket.IO: chat + calls + signaling + presence + feed/profile events

import { Server } from "socket.io";
import redis from "../redis.js";
import admin from "firebase-admin";

import * as chatService from "../services/chatService.js";
import * as callService from "../services/callService.js";
import { ClientProfile } from "../models/Profile.js";
import { Pro } from "../models.js";

/* ---------------------------------------------------
   IO reference (services use getIO without import loop)
--------------------------------------------------- */
let ioRef = null;
export function getIO() {
  return ioRef;
}

/* ---------------------------------------------------
   CORS checker (same logic as server.js)
--------------------------------------------------- */
function buildOriginChecker() {
  const allowList = String(process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const allowVercel = (process.env.ALLOW_VERCEL_PREVIEWS || "true") !== "false";

  return function originAllowed(origin) {
    if (!origin) return true;
    try {
      const host = new URL(origin).host;
      for (const o of allowList) {
        try {
          if (new URL(o).host === host) return true;
          if (o === origin) return true;
        } catch {}
      }
      if (allowVercel && host.endsWith(".vercel.app")) return true;
    } catch {}
    return false;
  };
}

/* ---------------------------------------------------
   Room helpers
--------------------------------------------------- */
const roomName = (r) => (typeof r === "string" ? r : "");
const userRoom = (uid) => `user:${String(uid)}`;
const profileRoom = (uid) => `profile:${String(uid)}`;
const bookingRoom = (id) => `booking:${String(id)}`;
const postRoom = (id) => `post:${String(id)}`;

/* ---------------------------------------------------
   safeEmit (never throw)
--------------------------------------------------- */
function safeEmit(target, evt, payload) {
  try {
    ioRef?.to(target).emit(evt, payload);
  } catch (err) {
    console.warn(`[safeEmit] ${evt} @ ${target}:`, err?.message || err);
  }
}

/* ---------------------------------------------------
   MAIN: attachSockets()
--------------------------------------------------- */
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

  ioRef = io;

  // allow services to emit using getIO()
  try {
    if (chatService?.setGetIO) chatService.setGetIO(getIO);
    if (callService?.setGetIO) callService.setGetIO(getIO);
  } catch (e) {
    console.warn("[sockets] setGetIO failed:", e?.message || e);
  }

  /* ---------------------------------------------------
     Connection / Auth
  --------------------------------------------------- */
  io.on("connection", (socket) => {
    const hinted =
      socket.handshake.auth?.uid ||
      socket.handshake.query?.uid ||
      null;

    // authReady promise: handlers await this so they always
    // see the final verified socket.data.uid
    const authReady = (async () => {
      try {
        const provided =
          socket.handshake.auth?.token ||
          socket.handshake.auth?.Authorization ||
          socket.handshake.query?.token ||
          null;

        let uid = hinted;

        if (provided) {
          const raw = typeof provided === "string" && provided.startsWith("Bearer ")
            ? provided.slice(7)
            : provided;
          try {
            const decoded = await admin.auth().verifyIdToken(raw);
            uid = decoded.uid;
            socket.data.firebaseUser = decoded;
            socket.data.authenticated = true;
            // console.log("[sockets] verified uid on connect:", decoded.uid);
          } catch (e) {
            console.warn("[socket] token verify failed:", e?.message || e);
          }
        }

        socket.data = socket.data || {};
        socket.data.uid = uid;
        if (uid) socket.join(userRoom(uid));
      } catch (e) {
        console.warn("[socket] auth error:", e?.message || e);
      }
    })();

    /* ---------------------------------------------------
       Room Join + Presence
       (await authReady to ensure socket.data.uid is set)
    --------------------------------------------------- */
    socket.on("room:join", async ({ room, who } = {}, ack) => {
      await authReady;
      const r = roomName(room);
      if (!r) return ack?.({ ok: false, error: "room_required" });

      socket.join(r);
      socket.data.room = r;
      socket.data.who = who || socket.data.uid || hinted || "anon";

      const peers = Array.from(io.sockets.adapter.rooms.get(r) || [])
        .filter((id) => id !== socket.id);

      socket.to(r).emit("presence:join", {
        user: socket.data.who,
        id: socket.id,
        count: peers.length + 1,
      });

      ack?.({ ok: true, room: r, peers, count: peers.length + 1 });
    });

    socket.on("join:booking", async ({ bookingId, who } = {}, ack) => {
      await authReady;
      const id = String(bookingId || "");
      if (!id) return ack?.({ ok: false, error: "bookingId_required" });

      const r = bookingRoom(id);
      socket.join(r);
      socket.data.room = r;
      socket.data.who = who || socket.data.uid || hinted || "anon";

      const peers = Array.from(io.sockets.adapter.rooms.get(r) || [])
        .filter((id) => id !== socket.id);

      socket.to(r).emit("presence:join", {
        user: socket.data.who,
        id: socket.id,
        count: peers.length + 1,
      });

      ack?.({ ok: true, room: r, peers, count: peers.length + 1 });
    });

    socket.on("room:leave", async ({ room } = {}, ack) => {
      await authReady;
      const r = roomName(room) || socket.data.room;
      if (!r) return ack?.({ ok: false, error: "room_required" });

      socket.leave(r);
      socket.to(r).emit("presence:leave", {
        user: socket.data.who || socket.data.uid || hinted || "anon",
        id: socket.id,
      });

      if (socket.data.room === r) delete socket.data.room;
      ack?.({ ok: true });
    });

    /* ---------------------------------------------------
       Chat
    --------------------------------------------------- */
    socket.on("chat:message", async (msg = {}, ack) => {
  await authReady;
  try {
    const r = roomName(msg.room) || socket.data.room;
    if (!r) return ack?.({ ok: false, error: "room_required" });

    const text = msg.text ?? msg.message ?? msg.body ?? "";
    const meta = msg.meta || {};
    const attachmentsRaw = Array.isArray(meta.attachments) ? meta.attachments : [];

    if (!text && attachmentsRaw.length === 0) {
      return ack?.({ ok: false, error: "message_empty" });
    }

    const fromUid = socket.data.uid || msg.fromUid || hinted || socket.id;

    // determine DM peer
    let toUid = null;
    const parts = String(r).split(":");
    if (parts[0] === "dm" && parts.length === 3) {
      const [, a, b] = parts;
      toUid = fromUid === a ? b : fromUid === b ? a : null;
    }

    const attachments = attachmentsRaw.map((a) => ({
      url: a.url,
      type: a.type || "file",
      name: a.name || "",
      size: a.size || 0,
    }));

    const res = await chatService.saveMessage({
      room: r,
      fromUid,
      toUid,
      body: text,
      attachments,
      meta,
      clientId: msg.clientId || null,
    });

    // chatService.saveMessage already:
    //  - builds payload
    //  - attaches sender
    //  - emits "chat:message" to the room
    const payload = res.message;

    return ack?.({
      ok: true,
      id: payload?.id,
      existing: !!res.existing,
    });
  } catch (err) {
    console.warn("[chat:message] error:", err?.message || err);
    return ack?.({ ok: false, error: "save_failed" });
  }
});


        // 🔥 NEW: mark messages in a room as read via socket (no HTTP)
    socket.on("chat:read", async (payload = {}, ack) => {
      await authReady;
      try {
        const r = roomName(
          (payload && payload.room) || socket.data.room || ""
        );
        if (!r) {
          ack?.({ ok: false, error: "room_required" });
          return;
        }

        const uid = socket.data.uid || hinted;
        if (!uid) {
          ack?.({ ok: false, error: "no_uid" });
          return;
        }

        // use your existing chatService.markRoomRead
        const res = await chatService.markRoomRead(r, uid);

        // markRoomRead itself already emits "chat:seen" to that room,
        // which your ChatPane is listening for.
        ack?.({ ok: true, updated: res?.updated ?? 0 });
      } catch (err) {
        console.warn("[socket] chat:read failed:", err?.message || err);
        ack?.({ ok: false, error: "mark_read_failed" });
      }
    });


    /* ---------------------------------------------------
       WebRTC signaling
    --------------------------------------------------- */
    ["webrtc:offer", "webrtc:answer", "webrtc:ice"].forEach((evt) => {
      socket.on(evt, async ({ room, payload } = {}, cb) => {
        await authReady;
        const r = roomName(room) || socket.data.room;
        if (!r || payload == null) {
          return cb?.({ ok: false, error: "room_or_payload_required" });
        }

        socket.to(r).emit(evt, {
          payload,
          from: socket.data.uid || hinted || socket.id,
        });

        cb?.({ ok: true });
      });
    });

    /* ---------------------------------------------------
       Call: initiate (delegated to callService)
    --------------------------------------------------- */
    socket.on("call:initiate", async (p = {}, ack) => {
      await authReady;
      try {
        const callerUid = socket.data.uid || hinted || socket.id;
        if (!callerUid) return ack?.({ ok: false, error: "no_uid" });

        if (!p.receiverUid) return ack?.({ ok: false, error: "receiverUid_required" });

        const callId = p.callId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const room = p.room || `call:${callId}`;

        // centralised service creates record, emits and notifies
        const call = await callService.createCall({
          callId,
          room,
          callerUid,
          receiverUids: [p.receiverUid],
          callType: p.callType || "audio",
          meta: p.meta || {},
        });

        ack?.({
          ok: true,
          id: String(call._id),
          callId: call.callId,
          room: call.room,
          callType: call.callType,
        });
      } catch (err) {
        console.error("[call:initiate] err:", err?.message || err);
        ack?.({ ok: false, error: "call_initiate_failed" });
      }
    });

    /* ---------------------------------------------------
       Call: status (delegated to callService)
    --------------------------------------------------- */
    socket.on("call:status", async (p = {}, ack) => {
      await authReady;
      try {
        const { callId, status, meta } = p || {};
        if (!callId) return ack?.({ ok: false, error: "callId_required" });
        if (!status) return ack?.({ ok: false, error: "status_required" });

        const updated = await callService.updateCallStatus(callId, { status, meta });

        // callService will emit to rooms/participants; ack with summary
        ack?.({ ok: true, id: String(updated._id), status: updated.status });
      } catch (err) {
        console.error("[call:status] err:", err?.message || err);
        ack?.({ ok: false, error: "call_status_failed" });
      }
    });

    /* ---------------------------------------------------
       Disconnect presence
    --------------------------------------------------- */
    socket.on("disconnecting", async () => {
      await authReady;
      const rooms = [...socket.rooms].filter((r) => r !== socket.id);
      rooms.forEach((r) => {
        socket.to(r).emit("presence:leave", {
          user: socket.data.who || socket.data.uid || hinted || "anon",
          id: socket.id,
          reason: "disconnect",
        });
      });
    });
  });

  /* ---------------------------------------------------
     Redis pub/sub (feed, profile, notifications)
  --------------------------------------------------- */
  (async () => {
    if (!redis) {
      console.warn("[sockets] Redis not configured — pub/sub skipped");
      return;
    }

    const sub = typeof redis.duplicate === "function" ? redis.duplicate() : redis;
    await sub.connect?.();

    const safeParse = (raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };

    if (sub.subscribe) {
      // post stats
      await sub.subscribe("channel:post:stats", (raw) => {
        const p = safeParse(raw);
        if (p?.postId) safeEmit(postRoom(p.postId), "post:stats", p);
      });

      // profile follow
      await sub.subscribe("channel:profile:follow", (raw) => {
        const p = safeParse(raw);
        if (!p?.targetUid) return;

        // legacy event (back-compat)
        safeEmit(profileRoom(p.targetUid), "profile:follow", p);
        safeEmit(userRoom(p.targetUid), "notification:new", p);

        // canonical profile stats
        safeEmit(profileRoom(p.targetUid), "profile:stats", {
          ownerUid: p.targetUid,
          followersCount: p.followers ?? p.followersCount ?? null,
          metrics: p.metrics || (typeof p.followers !== "undefined" ? { followers: p.followers } : undefined),
        });
      });
    }
  })();

  console.log("[sockets] READY ✔");
  return io;
}
