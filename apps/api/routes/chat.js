// apps/api/routes/chat.js
import express from "express";
import ChatMessage from "../models/ChatMessage.js";
import Thread from "../models/Thread.js";
import * as chatService from "../services/chatService.js";
import { ClientProfile } from "../models/Profile.js";
import { Pro } from "../models.js";

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

        // optionally mark thread read when user opens it
    try {
      await Thread.markRead(room, meUid).catch(() => null);
    } catch (err) {
      console.warn("[chat:room] Thread.markRead failed:", err?.message || err);
    }

    // Enrich messages with sender profile so frontend can show names/avatars
    try {
      const reversed = items.reverse(); // oldest -> newest
      const uids = [...new Set(reversed.map((m) => m.fromUid).filter(Boolean))];

      const profileMap = {};
      if (uids.length) {
        const clients = await ClientProfile.find({ uid: { $in: uids } })
          .select("uid fullName displayName photoUrl username")
          .lean()
          .catch(() => []);
        clients.forEach((c) => {
          profileMap[c.uid] = {
            uid: c.uid,
            displayName: c.displayName || c.fullName || c.username || "",
            photoUrl: c.photoUrl || "",
          };
        });

        // fallback: try Pro documents for any missing uids
        const missing = uids.filter((u) => !profileMap[u]);
        if (missing.length) {
          const pros = await Pro.find({ ownerUid: { $in: missing } })
            .select("ownerUid name photoUrl")
            .lean()
            .catch(() => []);
          pros.forEach((p) => {
            profileMap[p.ownerUid] = {
              uid: p.ownerUid,
              displayName: p.name || "",
              photoUrl: p.photoUrl || "",
            };
          });
        }
      }

      const enriched = reversed.map((m) => ({
        ...m,
        fromUid: m.fromUid || null,
        clientId: m.clientId || null,
        sender: profileMap[m.fromUid] || null,
      }));

      return res.json({ items: enriched });
    } catch (err) {
      // graceful fallback: return raw reversed items if enrichment fails
      console.warn("[chat:room] sender enrichment failed:", err?.message || err);
      return res.json({ items: items.reverse() });
    }

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

      // optionally mark thread read when user opens it
      try {
        await Thread.markRead(room, meUid).catch(() => null);
      } catch (err) {
        console.warn("[chat:room] Thread.markRead failed:", err?.message || err);
      }

      // Enrich messages with sender profile for frontend
      try {
        const reversed = items.reverse(); // oldest -> newest
        const uids = [...new Set(reversed.map((m) => m.fromUid).filter(Boolean))];

        const profileMap = {};
        if (uids.length) {
          const clients = await ClientProfile.find({ uid: { $in: uids } })
            .select("uid fullName displayName photoUrl username")
            .lean()
            .catch(() => []);
          clients.forEach((c) => {
            profileMap[c.uid] = {
              uid: c.uid,
              displayName: c.displayName || c.fullName || c.username || "",
              photoUrl: c.photoUrl || "",
            };
          });

          const missing = uids.filter((u) => !profileMap[u]);
          if (missing.length) {
            const pros = await Pro.find({ ownerUid: { $in: missing } })
              .select("ownerUid name photoUrl")
              .lean()
              .catch(() => []);
            pros.forEach((p) => {
              profileMap[p.ownerUid] = {
                uid: p.ownerUid,
                displayName: p.name || "",
                photoUrl: p.photoUrl || "",
              };
            });
          }
        }

        const enriched = reversed.map((m) => ({
          ...m,
          fromUid: m.fromUid || null,
          clientId: m.clientId || null,
          sender: profileMap[m.fromUid] || null,
        }));

        return res.json({ items: enriched, room });
      } catch (err) {
        console.warn("[chat:with] sender enrichment failed:", err?.message || err);
        return res.json({ items: items.reverse(), room });
      }

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
    const items = await chatService.getInbox(meUid);
    // chatService.getInbox returns the array format expected by FE
    return res.json({ items });
  } catch (e) {
    console.error("GET /chat/inbox error:", e);
    return res.status(500).json({ error: "server_error" });
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

      // sync thread unreadCounts
try {
  await Thread.markRead(room, meUid).catch(() => null);
} catch (err) {
  console.warn("[chat:thread/read] Thread.markRead failed:", err?.message || err);
}


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

      // sync thread unreadCounts
try {
  await Thread.markRead(room, meUid).catch(() => null);
} catch (err) {
  console.warn("[chat:room/read] Thread.markRead failed:", err?.message || err);
}


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

    // Ensure a Thread exists and update participants (best-effort)
    try {
      if (String(room).startsWith("dm:")) {
        // ensure the DM Thread exists and has both participants
        const parts = room.split(":");
        if (parts.length >= 3) {
          const a = parts[1];
          const b = parts[2];
          await Thread.getOrCreateDMThread(a, b).catch(() => null);
        }
      } else if (String(room).startsWith("booking:")) {
        // ensure booking thread exists (participants can be added later when booking accepted)
        const bookingId = room.split(":")[1];
        if (bookingId) {
          await Thread.getOrCreateBookingThread(bookingId).catch(() => null);
        }
      }
      // Let chatService touchLastMessage handle snapshot/unread (it already does)
    } catch (err) {
      console.warn("[chat:post] ensure Thread failed:", err?.message || err);
    }

    // Update Thread snapshot & unread counters (best-effort)
try {
  const lastPreview = String(payload?.body || "").slice(0, 255);
  let incrementFor = null;

  // For DM -> increment unread for the other participant only
  if (String(room).startsWith("dm:")) {
    const parts = room.split(":");
    if (parts.length >= 3) {
      const a = parts[1];
      const b = parts[2];
      const recipient = a === fromUid ? b : b === fromUid ? a : null;
      if (recipient && recipient !== fromUid) incrementFor = [recipient];
    }
  }

  await Thread.touchLastMessage(room, {
    lastMessageId: payload?.id || null,
    lastMessageAt: payload?.createdAt ? new Date(payload.createdAt) : new Date(),
    lastMessagePreview: lastPreview,
    lastMessageFrom: fromUid,
    incrementFor, // null => thread participants except sender
  }).catch(() => null);
} catch (err) {
  console.warn("[chat:post] Thread.touchLastMessage failed:", err?.message || err);
}


    // Return success response for REST fallback
    return res.json({ ok: true, message: payload });
  } catch (e) {
    console.error("POST /chat/room/:room/message error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

return router;
}
