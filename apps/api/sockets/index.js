// apps/api/sockets/index.js
// Socket.IO signaling + chat + feed/profile events

import { Server } from "socket.io";
import redis from "../redis.js";
import admin from "firebase-admin";
import ChatMessage from "../models/ChatMessage.js";
import { createNotification } from "../services/notificationService.js";

// we will stash io here so routes and services can emit
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
        originAllowed(origin)
          ? cb(null, true)
          : cb(new Error("Socket.IO CORS blocked")),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    },
    path: "/socket.io",
    serveClient: false,
    pingTimeout: 25000,
    pingInterval: 20000,
  });

  // store for routes / services
  ioRef = io;

  io.on("connection", (socket) => {
    const handshakeUid =
      socket.handshake.auth?.uid || socket.handshake.query?.uid || null;
    const hintedUid =
      socket.handshake?.auth?.uid ||
      socket.handshake?.query?.uid ||
      handshakeUid ||
      null;

    // verify Firebase idToken or Authorization: Bearer <token> if provided; attach socket.data.uid
    (async () => {
      try {
        const authObj = socket.handshake?.auth || {};
        const provided =
          authObj.token ||
          authObj.Authorization ||
          authObj.authorization ||
          socket.handshake?.query?.token ||
          null;

        if (provided) {
          const raw =
            typeof provided === "string" && provided.startsWith("Bearer ")
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
            console.warn(
              "[sockets] token verify failed:",
              err?.message || err
            );
            socket.data = socket.data || {};
            socket.data.uid = hintedUid || null;
          }
        } else {
          socket.data = socket.data || {};
          socket.data.uid = hintedUid || null;
        }

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
      socket.data.who = who || socket.data.uid || handshakeUid || "anon";

      const peers = Array.from(io.sockets.adapter.rooms.get(r) || []).filter(
        (id) => id !== socket.id
      );
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
      socket.data.who = who || socket.data.uid || handshakeUid || "anon";

      const peers = Array.from(io.sockets.adapter.rooms.get(r) || []).filter(
        (sid) => sid !== socket.id
      );
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
        user: socket.data.who || socket.data.uid || handshakeUid || "anon",
        id: socket.id,
      });
      if (socket.data.room === r) delete socket.data.room;
      cb?.({ ok: true });
    });

    // --- Chat (persisted for dispute / history, with read + notifications) ---
    socket.on("chat:message", async (msg = {}) => {
      // Resolve room: explicit in msg or last joined
      const r = roomName(msg?.room) || socket.data.room;
      if (!r) return;

      // Text + meta
      const text = msg?.text ?? msg?.message ?? msg?.body ?? "";
      const meta = msg?.meta || {};

      // allow "attachments-only" messages (no text)
      const attachmentsRaw = Array.isArray(meta.attachments)
        ? meta.attachments
        : [];

      if (!text && attachmentsRaw.length === 0) return;

      // Who is sending?
      const fromUid =
        socket.data?.uid ||
        msg.fromUid ||
        msg.from ||
        socket.data?.who ||
        handshakeUid ||
        socket.id;

      // Determine DM receiver (toUid) from room name, only for dm: rooms
      let toUid = null;
      const parts = String(r).split(":");
      if (parts[0] === "dm" && parts.length === 3) {
        const [, uidA, uidB] = parts;
        if (fromUid === uidA) toUid = uidB;
        else if (fromUid === uidB) toUid = uidA;
        else {
          // if fromUid doesn't match either (weird), leave toUid = null
          toUid = null;
        }
      }

      // Normalise attachments for Mongo
      const attachments = attachmentsRaw.map((a) => ({
        url: a.url,
        type: a.type || "file",
        name: a.name || "",
        size: a.size || 0,
      }));

      // Persist message
      let doc = null;
      try {
        doc = await ChatMessage.create({
          room: r,
          fromUid,
          toUid,
          body: text,
          attachments,
          meta,
          seenBy: fromUid ? [fromUid] : [],
        });
      } catch (e) {
        console.warn("[sockets] chat save failed:", e?.message || e);
      }

      const payload = doc
        ? {
            id: String(doc._id),
            room: doc.room,
            from: doc.fromUid,
            fromUid: doc.fromUid,
            toUid: doc.toUid,
            body: doc.body,
            meta: doc.meta,
            attachments: doc.attachments,
            createdAt: doc.createdAt,
            seenBy: doc.seenBy,
          }
        : {
            // fallback (should rarely be used if DB is healthy)
            id: msg.id || undefined,
            room: r,
            from: fromUid,
            fromUid,
            toUid,
            body: text,
            meta,
            attachments,
            createdAt: msg?.at || new Date(),
            seenBy: fromUid ? [fromUid] : [],
          };

      // Broadcast to the whole room (including sender) so UI state is consistent
      io.to(r).emit("chat:message", payload);

      // DM-specific: create notification + incoming event for receiver
      if (toUid) {
        try {
          await createNotification({
            ownerUid: toUid,
            actorUid: fromUid,
            type: "chat_message",
            data: {
              room: r,
              fromUid,
              bodyPreview: text.slice(0, 140),
            },
          });

          // DM-specific event directly to receiver
          io.to(userRoom(toUid)).emit("dm:incoming", {
            room: r,
            fromUid,
            body: text,
            at: payload.createdAt,
          });
        } catch (e) {
          console.warn(
            "[sockets] createNotification/chat dm:incoming failed:",
            e?.message || e
          );
        }
      }
    });

    // --- WebRTC signaling ---
    ["webrtc:offer", "webrtc:answer", "webrtc:ice"].forEach((evt) => {
      socket.on(evt, ({ room, payload } = {}) => {
        const r = roomName(room) || socket.data.room;
        if (!r || payload == null) return;
        socket
          .to(r)
          .emit(evt, {
            payload,
            from: socket.data.who || socket.data.uid || handshakeUid || socket.id,
          });
      });
    });

    // Generic signaling
    socket.on("signal", ({ room, type, data } = {}) => {
      const r = roomName(room) || socket.data.room;
      if (!r || !type) return;
      socket.to(r).emit("signal", {
        type,
        data,
        from: socket.data.who || socket.data.uid || handshakeUid || socket.id,
      });
    });

    // --- Presence on disconnect ---
    socket.on("disconnecting", () => {
      const rooms = [...socket.rooms].filter((r) => r !== socket.id);
      rooms.forEach((r) =>
        socket.to(r).emit("presence:leave", {
          user: socket.data.who || socket.data.uid || handshakeUid || "anon",
          id: socket.id,
          reason: "disconnect",
        })
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
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };

    // subscribe: post stats
    if (typeof sub.subscribe === "function") {
      await sub.subscribe("channel:post:stats", (raw) => {
        const p = safeParse(raw);
        if (!p?.postId) return;
        ioRef?.to(postRoom(p.postId)).emit("post:stats", p);
      });

      // subscribe: profile follow
      await sub.subscribe("channel:profile:follow", (raw) => {
        const p = safeParse(raw);
        if (!p?.targetUid) return;

        // existing follow event (back-compat)
        ioRef?.to(profileRoom(p.targetUid)).emit("profile:follow", p);
        ioRef?.to(userRoom(p.targetUid)).emit("notification:new", p);

        // canonical stats event for frontends: include ownerUid and followersCount (and metrics if present)
        try {
          const statsPayload = {
            ownerUid: p.targetUid,
            followersCount: p.followers ?? p.followersCount ?? null,
            metrics:
              p.metrics ||
              (typeof p.followers !== "undefined"
                ? { followers: p.followers }
                : undefined),
          };
          ioRef
            ?.to(profileRoom(p.targetUid))
            .emit("profile:stats", statsPayload);
        } catch (e) {
          console.warn(
            "[sockets] emit profile:stats failed",
            e?.message || e
          );
        }
      });

      console.log("[sockets] subscribed to Redis channels");
    }
  })();

  console.log("[sockets] ✅ Socket.IO attached (with feed events hook)");
  return io;
}
