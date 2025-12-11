// apps/api/services/chatService.js
import ChatMessage from "../models/ChatMessage.js";
import Thread from "../models/Thread.js";
import { createNotification } from "./notificationService.js";
import { ClientProfile } from "../models/Profile.js";
import { Pro } from "../models.js";

/**
 * chatService
 *
 * Exports:
 *  - setGetIO(fn)                  // call from sockets after io exists
 *  - saveMessage({...})
 *  - getMessages(room, opts)
 *  - getInbox(uid)
 *  - markThreadRead(peerUid, uid)
 *  - markRoomRead(room, uid)
 *  - toggleStar(messageId, uid)
 *  - togglePin(messageId, uid)
 *  - toggleReaction(messageId, uid, emoji)
 *  - deleteForMe(messageId, uid)
 */

let _getIO = () => null;
export function setGetIO(fn) {
  _getIO = typeof fn === "function" ? fn : () => null;
}
function getIO() {
  try {
    return _getIO() || null;
  } catch {
    return null;
  }
}

function userRoom(uid) {
  return `user:${String(uid)}`;
}

function buildPayloadFromDoc(doc) {
  if (!doc) return null;

  const meta = doc.meta || {};
  const attachments = doc.attachments || [];
  const seenBy = Array.isArray(doc.seenBy) ? doc.seenBy : [];

  // ⭐ project star / pin from meta onto top-level fields
  const starredBy = Array.isArray(meta.starredBy) ? meta.starredBy : [];
  const pinnedBy = Array.isArray(meta.pinnedBy) ? meta.pinnedBy : [];

  // 😀 build reactions array from meta.myReactions
  let reactions = [];
  if (Array.isArray(doc.reactions)) {
    reactions = doc.reactions;
  } else if (meta.myReactions && typeof meta.myReactions === "object") {
    reactions = Object.entries(meta.myReactions).map(([uid, emoji]) => ({
      uid,
      emoji,
    }));
  }

  return {
    id: String(doc._id),
    room: doc.room,
    from: doc.fromUid,
    fromUid: doc.fromUid,
    toUid: doc.toUid || null,
    body: doc.body,
    meta,
    attachments,
    createdAt: doc.createdAt || doc.created_at || new Date(),
    seenBy,
    clientId: doc.clientId || null,

    // 🔑 these are what ChatPane is expecting:
    starredBy,
    pinnedBy,
    reactions,
  };
}


async function attachSender(payload) {
  if (!payload || !payload.fromUid) return payload;
  const uid = payload.fromUid;

  try {
    // 1) Try unified client profile
    let client = await ClientProfile.findOne({ uid })
      .select("uid fullName displayName username photoUrl identity")
      .lean()
      .catch(() => null);

    if (client) {
      payload.sender = {
        uid,
        displayName:
          client.displayName ||
          client.fullName ||
          client.username ||
          null,
        photoUrl:
          client.photoUrl ||
          (client.identity && client.identity.photoUrl) ||
          null,
      };
      return payload;
    }

    // 2) Fallback to Pro document
    const pro = await Pro.findOne({ ownerUid: uid })
      .select("ownerUid name username photoUrl")
      .lean()
      .catch(() => null);

    if (pro) {
      payload.sender = {
        uid,
        displayName: pro.name || pro.username || null,
        photoUrl: pro.photoUrl || null,
      };
      return payload;
    }

    // 3) Last fallback: keep uid only, no displayName
    payload.sender = {
      uid,
      displayName: null,
      photoUrl: null,
    };
  } catch (e) {
    console.warn("[chatService] attachSender failed:", e?.message || e);
  }

  return payload;
}

export async function saveMessage({
  room,
  fromUid,
  toUid = null,
  clientId = null,
  body = "",
  attachments = [],
  meta = {},
} = {}) {
  if (!room) throw new Error("room required");
  if (!fromUid) throw new Error("fromUid required");

  // 1) dedupe by clientId if provided
  try {
    if (clientId) {
      const existing = await ChatMessage.findOne({ room, fromUid, clientId }).lean();
      if (existing) {
        // build payload from existing doc and attach sender
        let payload = buildPayloadFromDoc(existing);
        await attachSender(payload);
        return { ok: true, existing: true, message: payload };
      }
    }
  } catch (e) {
    // continue to save if dedupe check fails for any reason
    console.warn("[chatService] dedupe check failed:", e?.message || e);
  }

  // 2) create new message document
  let doc = null;
  try {
    const created = await ChatMessage.create({
      room,
      fromUid,
      toUid: toUid || null,
      clientId: clientId || null,
      body: body || "",
      attachments: Array.isArray(attachments) ? attachments : [],
      meta: meta || {},
      seenBy: fromUid ? [fromUid] : [],
    });
    doc = created;
  } catch (e) {
    console.error("[chatService] save failed:", e?.message || e);
    throw e;
  }

  // Build payload and attach sender BEFORE we emit
  let payload = buildPayloadFromDoc(doc);
  await attachSender(payload);

  // 2.b) Update Thread snapshot & unread counters (best-effort)
  (async () => {
    try {
      // compute lastPreview: prefer message text, otherwise indicate attachment
      const lastPreview = (function () {
        const text = String(body || "").trim();
        if (text.length) return text.slice(0, 255);
        if (payload?.attachments && payload.attachments.length) return "[attachment]";
        return "";
      })();

      // increment unread for recipients:
      let incrementFor = null;
      if (String(room).startsWith("dm:")) {
        const parts = String(room).split(":");
        if (parts.length >= 3) {
          const uidA = parts[1];
          const uidB = parts[2];
          const recipient = uidA === fromUid ? uidB : uidB === fromUid ? uidA : null;
          if (recipient && recipient !== fromUid) incrementFor = [recipient];
        }
      } else if (toUid) {
        incrementFor = [toUid];
      } else if (String(room).startsWith("booking:")) {
        incrementFor = null;
      }

      // ensure DM/booking threads have canonical participants where possible
      try {
        if (String(room).startsWith("dm:")) {
          const parts = String(room).split(":");
          if (parts.length >= 3) {
            await Thread.getOrCreateDMThread(parts[1], parts[2]).catch(() => null);
          }
        } else if (String(room).startsWith("booking:")) {
          const bookingId = String(room).split(":")[1];
          if (bookingId) await Thread.getOrCreateBookingThread(bookingId).catch(() => null);
        }
      } catch (e) {
        // best-effort
        console.warn("[chatService] ensure thread participants failed:", e?.message || e);
      }

      await Thread.touchLastMessage(room, {
        lastMessageId: doc._id,
        lastMessageAt: doc.createdAt || new Date(),
        lastMessagePreview: lastPreview,
        lastMessageFrom: fromUid,
        incrementFor,
      }).catch((err) => {
        console.warn("[chatService] Thread.touchLastMessage failed:", err?.message || err);
      });
    } catch (err) {
      console.warn("[chatService] thread update error:", err?.message || err);
    }
  })().catch((err) => {
    console.warn("[chatService] unexpected thread update error:", err?.message || err);
  });

  // 3) emit to room — payload already has sender attached
  try {
    const io = getIO();
    io?.to(room).emit("chat:message", payload);
  } catch (e) {
    console.warn("[chatService] emit chat:message failed:", e?.message || e);
  }

  // 4) if DM -> notify recipient (via Notification + dm:incoming)
  try {
    // DM rooms expected to be "dm:<uidA>:<uidB>"
    if (String(room).startsWith("dm:")) {
      const parts = String(room).split(":");
      if (parts.length >= 3) {
        const uidA = parts[1];
        const uidB = parts[2];
        // compute recipient robustly
        const recipient = uidA === fromUid ? uidB : uidB === fromUid ? uidA : null;
        const realRecipient = toUid || recipient || null;

        if (realRecipient && realRecipient !== fromUid) {
          // create a notification record for the recipient
          try {
            await createNotification({
              toUid: realRecipient,
              fromUid,
              type: "chat_message",
              data: {
                room,
                fromUid,
                bodyPreview: (body || "").slice(0, 140),
              },
            });
          } catch (e) {
            console.warn(
              "[chatService] createNotification(chat_message) failed:",
              e?.message || e
            );
          }

          // also emit a DM-specific incoming event
          try {
            const io = getIO();
            io?.to(userRoom(realRecipient)).emit("dm:incoming", {
              room,
              fromUid,
              body: body || "",
              at: payload.createdAt,
            });
          } catch (e) {
            console.warn("[chatService] emit dm:incoming failed:", e?.message || e);
          }
        }
      }
    } else if (toUid) {
      // not a dm room, but toUid provided (one-to-one); still notify
      try {
        await createNotification({
          toUid,
          fromUid,
          type: "chat_message",
          data: { room, fromUid, bodyPreview: (body || "").slice(0, 140) },
        });
      } catch (e) {
        console.warn(
          "[chatService] createNotification(chat_message) failed:",
          e?.message || e
        );
      }
      try {
        const io = getIO();
        io?.to(userRoom(toUid)).emit("dm:incoming", {
          room,
          fromUid,
          body: body || "",
          at: payload.createdAt,
        });
      } catch (e) {
        console.warn("[chatService] emit dm:incoming (toUid flow) failed:", e?.message || e);
      }
    }
  } catch (e) {
    console.warn("[chatService] dm notify flow failed:", e?.message || e);
  }

  return { ok: true, existing: false, message: payload };
}

/**
 * getMessages(room, { limit = 50, before = null })
 * - returns messages sorted ascending by createdAt (oldest first)
 * - cursor = last message createdAt (ISO) for next page (use before < cursor)
 */
export async function getMessages(room, { limit = 50, before = null } = {}) {
  if (!room) throw new Error("room required");
  const take = Math.max(1, Math.min(200, Number(limit || 50)));

  const q = { room };
  if (before) {
    const date = new Date(before);
    if (!Number.isNaN(date.getTime())) {
      q.createdAt = { $lt: date };
    }
  }

  const docs = await ChatMessage.find(q).sort({ createdAt: -1 }).limit(take).lean();
  const items = docs.reverse().map(buildPayloadFromDoc);
  const cursor = items.length ? items[items.length - 1].createdAt : null;
  return { items, cursor };
}

/**
 * getInbox(uid)
 * - returns [ { room, peerUid, lastBody, lastFromUid, lastAt, unreadCount } ]
 *
 * Prefer Thread collection for fast inbox. Fallback to scanning ChatMessage if Thread not present.
 */
export async function getInbox(uid) {
  if (!uid) throw new Error("uid required");

  // Try to use Thread collection first (fast list of threads)
  try {
    const threads = await Thread.find({
      participants: uid,
      archived: { $ne: true },
    })
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .lean();

    if (Array.isArray(threads) && threads.length) {
      const out = [];

      for (const t of threads) {
        let peerUid = null;

        if (t.type === "dm" || String(t.room).startsWith("dm:")) {
          const parts = String(t.room).split(":");
          if (parts.length >= 3) {
            const a = parts[1];
            const b = parts[2];
            peerUid = a === uid ? b : b === uid ? a : null;
          }
        } else if (t.type === "booking") {
          // booking threads – peer ambiguous, leave null (FE can treat specially)
          peerUid = null;
        } else {
          // group/system etc.
          peerUid = null;
        }

        // 🟡 IMPORTANT: recompute unread from ChatMessage, don't trust t.unreadCounts
        let unreadCount = 0;
        try {
          unreadCount = await ChatMessage.countDocuments({
            room: t.room,
            toUid: uid,
            seenBy: { $ne: uid },
          });
        } catch (e) {
          console.warn(
            "[chatService] getInbox unread recompute failed:",
            e?.message || e
          );
          // fallback to whatever is in Thread, if available
          unreadCount =
            (t.unreadCounts && Number(t.unreadCounts[uid] || 0)) || 0;
        }

        out.push({
          room: t.room,
          peerUid,
          lastBody: t.lastMessagePreview || "",
          lastFromUid: t.lastMessageFrom || "",
          lastAt: t.lastMessageAt || t.updatedAt || t.createdAt,
          unreadCount: Number(unreadCount || 0),
        });
      }

      return out;
    }
  } catch (e) {
    console.warn(
      "[chatService] getInbox(thread) failed, falling back:",
      e?.message || e
    );
    // fallback to message-scan below
  }

  // Fallback: original behaviour (scan ChatMessage rooms)
  const rooms = await ChatMessage.find({
    $or: [{ fromUid: uid }, { toUid: uid }],
  })
    .distinct("room")
    .catch(() => []);

  const out = [];
  for (const r of rooms) {
    try {
      const last = await ChatMessage.find({ room: r })
        .sort({ createdAt: -1 })
        .limit(1)
        .lean();
      const lastDoc = last && last[0] ? last[0] : null;
      if (!lastDoc) continue;

      // compute peerUid for dm rooms
      let peerUid = null;
      if (String(r).startsWith("dm:")) {
        const parts = String(r).split(":");
        if (parts.length >= 3) {
          const a = parts[1];
          const b = parts[2];
          peerUid = a === uid ? b : b === uid ? a : null;
        }
      } else {
        peerUid =
          lastDoc.fromUid === uid ? lastDoc.toUid || null : lastDoc.fromUid;
      }

      const unreadCount = await ChatMessage.countDocuments({
        room: r,
        toUid: uid,
        seenBy: { $ne: uid },
      }).catch(() => 0);

      out.push({
        room: r,
        peerUid,
        lastBody: lastDoc.body || "",
        lastFromUid: lastDoc.fromUid || "",
        lastAt: lastDoc.createdAt || new Date(),
        unreadCount: Number(unreadCount || 0),
      });
    } catch (e) {
      console.warn(
        "[chatService] getInbox: item failed for room",
        r,
        e?.message || e
      );
    }
  }

  out.sort(
    (a, b) =>
      new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()
  );
  return out;
}


/**
 * markThreadRead(peerUid, uid)
 * - marks DM thread between uid & peerUid as seen by uid
 */
export async function markThreadRead(peerUid, uid) {
  if (!peerUid) throw new Error("peerUid required");
  if (!uid) throw new Error("uid required");

  const roomA = `dm:${uid}:${peerUid}`;
  const roomB = `dm:${peerUid}:${uid}`;
  try {
    const res = await ChatMessage.updateMany(
      {
        room: { $in: [roomA, roomB] },
        toUid: uid,
        seenBy: { $ne: uid },
      },
      { $addToSet: { seenBy: uid } }
    );

    // also update Thread unreadCounts (best-effort)
    try {
      await Thread.markRead(roomA, uid).catch(() =>
        Thread.markRead(roomB, uid).catch(() => null)
      );
    } catch (err) {
      // non-fatal
      console.warn("[chatService] Thread.markRead failed:", err?.message || err);
    }

    // 🔥 LIVE "SEEN" UPDATE: emit to both possible dm rooms
    try {
      const io = getIO();
      if (io) {
        io.to(roomA).emit("chat:seen", { room: roomA, seenBy: uid });
        io.to(roomB).emit("chat:seen", { room: roomB, seenBy: uid });
      }
    } catch (err) {
      console.warn(
        "[chatService] emit chat:seen (thread) failed:",
        err?.message || err
      );
    }

    return { ok: true, updated: res?.modifiedCount ?? res?.nModified ?? 0 };
  } catch (e) {
    console.warn("[chatService] markThreadRead failed:", e?.message || e);
    return { ok: false, error: e?.message || e };
  }
}

/**
 * markRoomRead(room, uid)
 * - marks all messages in a room as seen by uid
 */
export async function markRoomRead(room, uid) {
  if (!room) throw new Error("room required");
  if (!uid) throw new Error("uid required");

  try {
    const res = await ChatMessage.updateMany(
      { room, toUid: uid, seenBy: { $ne: uid } },
      { $addToSet: { seenBy: uid } }
    );

    // also update Thread unreadCounts (best-effort)
    try {
      await Thread.markRead(room, uid).catch(() => null);
    } catch (err) {
      console.warn("[chatService] Thread.markRead(room) failed:", err?.message || err);
    }

    // 🔥 LIVE "SEEN" UPDATE for this room (DM or booking)
    try {
      const io = getIO();
      if (io) {
        io.to(room).emit("chat:seen", { room, seenBy: uid });
      }
    } catch (err) {
      console.warn(
        "[chatService] emit chat:seen (room) failed:",
        err?.message || err
      );
    }

    return { ok: true, updated: res?.modifiedCount ?? res?.nModified ?? 0 };
  } catch (e) {
    console.warn("[chatService] markRoomRead failed:", e?.message || e);
    return { ok: false, error: e?.message || e };
  }
}

/* -------------------------------------------------
   ⭐ NEW: Star / Pin / React / Delete-for-me helpers
   (stored in doc.meta so no schema change needed)
-------------------------------------------------- */

export async function toggleStar(messageId, uid) {
  if (!messageId) throw new Error("messageId required");
  if (!uid) throw new Error("uid required");

  const doc = await ChatMessage.findById(messageId);
  if (!doc) throw new Error("message_not_found");

  const meta = doc.meta || {};
  const prev = Array.isArray(meta.starredBy) ? meta.starredBy : [];

  if (prev.includes(uid)) {
    meta.starredBy = prev.filter((x) => x !== uid);
  } else {
    meta.starredBy = [...prev, uid];
  }

  doc.meta = meta;
  await doc.save();

  let payload = buildPayloadFromDoc(doc);
  await attachSender(payload);

  const io = getIO();
  io?.to(doc.room).emit("chat:update", payload);

  return { ok: true, message: payload };
}

export async function togglePin(messageId, uid) {
  if (!messageId) throw new Error("messageId required");
  if (!uid) throw new Error("uid required");

  const doc = await ChatMessage.findById(messageId);
  if (!doc) throw new Error("message_not_found");

  const meta = doc.meta || {};
  const prev = Array.isArray(meta.pinnedBy) ? meta.pinnedBy : [];

  if (prev.includes(uid)) {
    meta.pinnedBy = prev.filter((x) => x !== uid);
  } else {
    meta.pinnedBy = [...prev, uid];
  }

  doc.meta = meta;
  await doc.save();

  let payload = buildPayloadFromDoc(doc);
  await attachSender(payload);

  const io = getIO();
  io?.to(doc.room).emit("chat:update", payload);

  return { ok: true, message: payload };
}

export async function toggleReaction(messageId, uid, emoji) {
  if (!messageId) throw new Error("messageId required");
  if (!uid) throw new Error("uid required");

  const doc = await ChatMessage.findById(messageId);
  if (!doc) throw new Error("message_not_found");

  const meta = doc.meta || {};
  const myReactions =
    meta.myReactions && typeof meta.myReactions === "object"
      ? meta.myReactions
      : {};

  if (!emoji) {
    // clear my reaction
    delete myReactions[uid];
  } else {
    // set/replace my reaction
    myReactions[uid] = emoji;
  }

  meta.myReactions = myReactions;
  doc.meta = meta;
  await doc.save();

  let payload = buildPayloadFromDoc(doc);
  await attachSender(payload);

  const io = getIO();
  io?.to(doc.room).emit("chat:update", payload);

  return { ok: true, message: payload };
}

export async function deleteForMe(messageId, uid) {
  if (!messageId) throw new Error("messageId required");
  if (!uid) throw new Error("uid required");

  const doc = await ChatMessage.findById(messageId);
  if (!doc) throw new Error("message_not_found");

  const meta = doc.meta || {};
  const prev = Array.isArray(meta.deletedFor) ? meta.deletedFor : [];

  if (!prev.includes(uid)) {
    meta.deletedFor = [...prev, uid];
    doc.meta = meta;
    await doc.save();
  }

  let payload = buildPayloadFromDoc(doc);
  await attachSender(payload);

  const io = getIO();
  io?.to(doc.room).emit("chat:update", payload);

  return { ok: true, message: payload };
}

/* -------------------------------------------------
   Default export
-------------------------------------------------- */

export default {
  setGetIO,
  saveMessage,
  getMessages,
  getInbox,
  markThreadRead,
  markRoomRead,
  toggleStar,
  togglePin,
  toggleReaction,
  deleteForMe,
};
