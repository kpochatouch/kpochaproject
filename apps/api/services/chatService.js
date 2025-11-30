// apps/api/services/chatService.js
import ChatMessage from "../models/ChatMessage.js";
import { createNotification } from "./notificationService.js";

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
  return {
    id: String(doc._id),
    room: doc.room,
    from: doc.fromUid,
    fromUid: doc.fromUid,
    toUid: doc.toUid || null,
    body: doc.body,
    meta: doc.meta || {},
    attachments: doc.attachments || [],
    createdAt: doc.createdAt || doc.created_at || new Date(),
    seenBy: Array.isArray(doc.seenBy) ? doc.seenBy : [],
  };
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
        return { ok: true, existing: true, message: buildPayloadFromDoc(existing) };
      }
    }
  } catch (e) {
    // continue to save if dedupe check fails for any reason
    console.warn("[chatService] dedupe check failed:", e?.message || e);
  }

  // 2) create
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

  const payload = buildPayloadFromDoc(doc);

  // 3) emit to room
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
            console.warn("[chatService] createNotification(chat_message) failed:", e?.message || e);
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
        console.warn("[chatService] createNotification(chat_message) failed:", e?.message || e);
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
 */
export async function getInbox(uid) {
  if (!uid) throw new Error("uid required");

  const rooms = await ChatMessage.find({
    $or: [{ fromUid: uid }, { toUid: uid }],
  })
    .distinct("room")
    .catch(() => []);

  const out = [];
  for (const r of rooms) {
    try {
      const last = await ChatMessage.find({ room: r }).sort({ createdAt: -1 }).limit(1).lean();
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
        peerUid = lastDoc.fromUid === uid ? lastDoc.toUid || null : lastDoc.fromUid;
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
      console.warn("[chatService] getInbox: item failed for room", r, e?.message || e);
    }
  }

  out.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
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
    return { ok: true, updated: res?.modifiedCount ?? res?.nModified ?? 0 };
  } catch (e) {
    console.warn("[chatService] markRoomRead failed:", e?.message || e);
    return { ok: false, error: e?.message || e };
  }
}

export default {
  setGetIO,
  saveMessage,
  getMessages,
  getInbox,
  markThreadRead,
  markRoomRead,
};
