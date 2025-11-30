// apps/api/routes/chat.js
import express from "express";
import ChatMessage from "../models/ChatMessage.js";
import * as chatService from "../services/chatService.js";

/**
 * Helper: canonical DM room
 * dm:<smallerUid>:<largerUid>
 */
function buildDmRoom(uidA, uidB) {
  const a = String(uidA);
  const b = String(uidB);
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
}

/**
 * Factory so we can reuse requireAuth from server.js.
 *
 * Usage in server.js:
 *   import chatRoutes from "./routes/chat.js";
 *   app.use("/api", chatRoutes({ requireAuth }));
 */
export default function chatRoutes({ requireAuth }) {
  const router = express.Router();

  /**
   * Generic room history
   * GET /api/chat/room/:room
   *
   * Works for:
   *  - booking:<id>       (BookingChat, booking rooms)
   *  - dm:<uid1>:<uid2>   (social DMs)
   */
  router.get("/chat/room/:room", requireAuth, async (req, res) => {
    try {
      const room = String(req.params.room || "").trim();
      if (!room) return res.status(400).json({ error: "room_required" });

      const meUid = req.user.uid;
      if (room.startsWith("dm:")) {
        const parts = room.split(":");
        if (!parts.includes(meUid)) {
          return res.status(403).json({ error: "not_allowed" });
        }
      }

      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
      const before = req.query.before || null;

      const q = { room };
      if (before) {
        const d = new Date(before);
        if (!Number.isNaN(d.getTime())) {
          q.createdAt = { $lt: d };
        } else {
          q._id = { $lt: before };
        }
      }

      const items = await ChatMessage.find(q)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      res.json({ items: items.reverse() });
    } catch (e) {
      console.error("GET /chat/room error:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  /**
   * DM history for the logged-in user and a peer:
   * GET /api/chat/with/:peerUid
   *
   * Computes dm:<uidA>:<uidB> and returns its messages.
   */
  router.get("/chat/with/:peerUid", requireAuth, async (req, res) => {
    try {
      const meUid = req.user.uid; // set by requireAuth in server.js
      const peerUid = String(req.params.peerUid || "").trim();
      if (!peerUid) {
        return res.status(400).json({ error: "peerUid_required" });
      }

      const room = buildDmRoom(meUid, peerUid);

      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
      const before = req.query.before || null;

      const q = { room };
      if (before) {
        const d = new Date(before);
        if (!Number.isNaN(d.getTime())) {
          q.createdAt = { $lt: d };
        } else {
          q._id = { $lt: before };
        }
      }

      const items = await ChatMessage.find(q)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      res.json({ items: items.reverse(), room });
    } catch (e) {
      console.error("GET /chat/with error:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  /**
   * DM inbox for the logged-in user
   *
   * Lists one entry per peer you've chatted with, with unread counts.
   * GET /api/chat/inbox
   *
   * Response:
   * {
   *   items: [
   *     {
   *       peerUid,
   *       room,
   *       lastBody,
   *       lastFromUid,
   *       lastAt,
   *       unreadCount
   *     },
   *     ...
   *   ]
   * }
   */
  router.get("/chat/inbox", requireAuth, async (req, res) => {
    try {
      const meUid = req.user.uid;

      // Fetch recent messages where I'm either sender or receiver
      const docs = await ChatMessage.find({
      room: /^dm:/, // only direct messages
      $or: [{ fromUid: meUid }, { toUid: meUid }],
    })

        .sort({ createdAt: -1 })
        .limit(500)
        .lean();

      const byPeer = new Map();

      for (const m of docs) {
        const {
          room,
          fromUid,
          toUid,
          body = "",
          createdAt,
          updatedAt,
          seenBy = [],
        } = m;

        const peerUid = fromUid === meUid ? toUid : fromUid;
        if (!peerUid) continue;

        // Initialize thread entry on first encounter (docs are newest first)
        if (!byPeer.has(peerUid)) {
          byPeer.set(peerUid, {
            peerUid,
            room: buildDmRoom(meUid, peerUid),
            lastBody: body,
            lastFromUid: fromUid,
            lastAt: createdAt || updatedAt,
            unreadCount: 0,
          });
        }

        // Unread logic: messages sent TO me, where I am not in seenBy
        if (toUid === meUid && Array.isArray(seenBy) && !seenBy.includes(meUid)) {
          const t = byPeer.get(peerUid);
          t.unreadCount += 1;
        }
      }

      res.json({ items: Array.from(byPeer.values()) });
    } catch (e) {
      console.error("GET /chat/inbox error:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  /**
   * Mark one DM thread as read for the logged-in user
   *
   * PUT /api/chat/thread/:peerUid/read
   *
   * Used when:
   *  - user opens a DM with peer
   *  - Inbox item clicked → navigate to /chat?with=<peerUid>
   */
  router.put("/chat/thread/:peerUid/read", requireAuth, async (req, res) => {
    try {
      const meUid = req.user.uid;
      const peerUid = String(req.params.peerUid || "").trim();
      if (!peerUid) {
        return res.status(400).json({ error: "peerUid_required" });
      }

      const room = buildDmRoom(meUid, peerUid);

      const result = await ChatMessage.updateMany(
        {
          room,
          toUid: meUid,
          seenBy: { $ne: meUid },
        },
        {
          $addToSet: { seenBy: meUid },
        }
      );

      res.json({ ok: true, updatedCount: result.modifiedCount || 0 });
    } catch (e) {
      console.error("PUT /chat/thread/:peerUid/read error:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  /**
   * Mark all messages in a specific room as read for the logged-in user.
   *
   * PUT /api/chat/room/:room/read
   *
   * This is used for:
   *  - booking chat: room = "booking:<id>"
   *  - any future room-based chat that doesn't know a specific peerUid
   */
  router.put("/chat/room/:room/read", requireAuth, async (req, res) => {
    try {
      const meUid = req.user.uid;
      const room = String(req.params.room || "").trim();
      if (!room) return res.status(400).json({ error: "room_required" });

      const result = await ChatMessage.updateMany(
        {
          room,
          toUid: meUid,
          seenBy: { $ne: meUid },
        },
        {
          $addToSet: { seenBy: meUid },
        }
      );

      res.json({ ok: true, updatedCount: result.modifiedCount || 0 });
    } catch (e) {
      console.error("PUT /chat/room/:room/read error:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  /**
 * POST /api/chat/room/:room/message
 * Body: { text, meta, clientId }
 *
 * REST fallback for sending chat messages (used when socket is unavailable)
 */
router.post("/chat/room/:room/message", requireAuth, async (req, res) => {
  try {
    const room = String(req.params.room || "").trim();
    if (!room) return res.status(400).json({ error: "room_required" });

    const { text = "", meta = {}, clientId = null } = req.body || {};
    const attachmentsRaw = Array.isArray(meta.attachments) ? meta.attachments : [];

    if ((!text || !String(text).trim()) && attachmentsRaw.length === 0) {
      return res.status(400).json({ error: "message_empty" });
    }

    const fromUid = req.user.uid;
    // Determine toUid for dm rooms
    let toUid = null;
    const parts = room.split(":");
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

    const res2 = await chatService.saveMessage({
      room,
      fromUid,
      toUid,
      clientId,
      body: String(text || ""),
      attachments,
      meta,
    });

    const payload = res2.message || null;

    // Try to emit via sockets so live clients see it (best-effort)
    try {
      const { getIO } = await import("../sockets/index.js");
      const io = getIO && getIO();
      if (io && payload) io.to(room).emit("chat:message", payload);
    } catch (e) {
      console.warn("[chat:post] emit failed:", e?.message || e);
    }

    return res.json({ ok: true, id: payload?.id, existing: !!res2.existing, message: payload });
  } catch (err) {
    console.error("[POST /chat/room/:room/message] error:", err?.stack || err);
    return res.status(500).json({ error: "send_failed" });
  }
});

  return router;
}
