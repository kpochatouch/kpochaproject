// apps/api/services/chatService.js
import ChatMessage from "../models/ChatMessage.js";
import Thread from "../models/Thread.js";
import { Booking } from "../models/Booking.js";
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
          client.displayName || client.fullName || client.username || null,
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

async function resolveMessageRecipient(room, fromUid, suppliedToUid = null) {
  const normalizedRoom = String(room || "").trim();
  const senderUid = String(fromUid || "");

  if (normalizedRoom.startsWith("dm:")) {
    const [, uidA, uidB, ...rest] = normalizedRoom.split(":");
    if (!uidA || !uidB || rest.length || (senderUid !== uidA && senderUid !== uidB)) {
      throw new Error("not_allowed");
    }
    return senderUid === uidA ? uidB : uidA;
  }

  if (normalizedRoom.startsWith("booking:")) {
    const bookingId = normalizedRoom.slice("booking:".length);
    if (!bookingId || bookingId.includes(":")) throw new Error("not_allowed");

    const booking = await Booking.findById(bookingId)
      .select("clientUid proOwnerUid")
      .lean()
      .catch(() => null);
    if (!booking) throw new Error("not_allowed");

    if (senderUid === String(booking.clientUid || "") && booking.proOwnerUid) {
      return String(booking.proOwnerUid);
    }
    if (senderUid === String(booking.proOwnerUid || "") && booking.clientUid) {
      return String(booking.clientUid);
    }
    throw new Error("not_allowed");
  }

  return suppliedToUid ? String(suppliedToUid) : null;
}

function notificationPreview(body, attachments = []) {
  const text = String(body || "").trim();
  if (text) return text.slice(0, 140);
  if (
    Array.isArray(attachments) &&
    attachments.some((attachment) =>
      String(attachment?.type || "").toLowerCase().startsWith("audio"),
    )
  ) {
    return "Sent you a voice message";
  }
  return Array.isArray(attachments) && attachments.length
    ? "Sent you an attachment"
    : "Sent you a message";
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

  const recipientUid = await resolveMessageRecipient(room, fromUid, toUid);

  // 1) dedupe by clientId if provided
  try {
    if (clientId) {
      const existing = await ChatMessage.findOne({
        room,
        fromUid,
        clientId,
      }).lean();
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
      toUid: recipientUid,
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
        if (payload?.attachments && payload.attachments.length)
          return "[attachment]";
        return "";
      })();

      // increment unread for recipients:
      let incrementFor = null;
      if (recipientUid && recipientUid !== fromUid) incrementFor = [recipientUid];

      // ensure DM/booking threads have canonical participants where possible
      try {
        if (String(room).startsWith("dm:")) {
          const parts = String(room).split(":");
          if (parts.length >= 3) {
            await Thread.getOrCreateDMThread(parts[1], parts[2]).catch(
              () => null,
            );
          }
        } else if (String(room).startsWith("booking:")) {
          const bookingId = String(room).split(":")[1];
          if (bookingId)
            await Thread.getOrCreateBookingThread(bookingId).catch(() => null);
        }
      } catch (e) {
        // best-effort
        console.warn(
          "[chatService] ensure thread participants failed:",
          e?.message || e,
        );
      }

      await Thread.touchLastMessage(room, {
        lastMessageId: doc._id,
        lastMessageAt: doc.createdAt || new Date(),
        lastMessagePreview: lastPreview,
        lastMessageFrom: fromUid,
        incrementFor,
      }).catch((err) => {
        console.warn(
          "[chatService] Thread.touchLastMessage failed:",
          err?.message || err,
        );
      });
    } catch (err) {
      console.warn("[chatService] thread update error:", err?.message || err);
    }
  })().catch((err) => {
    console.warn(
      "[chatService] unexpected thread update error:",
      err?.message || err,
    );
  });

  // 3) emit to room — payload already has sender attached
  try {
    const io = getIO();
    io?.to(room).emit("chat:message", payload);
  } catch (e) {
    console.warn("[chatService] emit chat:message failed:", e?.message || e);
  }

  // 4) Notify the resolved recipient for all one-to-one chat rooms.
  try {
    if (recipientUid && recipientUid !== fromUid) {
      const senderName =
        payload?.sender?.displayName || meta?.fromName || "New message";
      const senderAvatar = payload?.sender?.photoUrl || meta?.fromAvatar || "";
      const bodyPreview = notificationPreview(body, attachments);

      await createNotification({
        toUid: recipientUid,
        fromUid,
        type: "chat_message",
        title: senderName,
        body: bodyPreview,
        data: {
          room,
          fromUid,
          peerUid: fromUid,
          actorName: senderName,
          actorAvatar: senderAvatar,
          bodyPreview,
          ...(String(room).startsWith("booking:")
            ? { bookingId: String(room).slice("booking:".length) }
            : {}),
        },
        groupKey: `chat:${room}`,
      });

      getIO()?.to(userRoom(recipientUid)).emit("dm:incoming", {
        room,
        fromUid,
        body: bodyPreview,
        at: payload.createdAt,
      });
    }
  } catch (e) {
    console.warn("[chatService] chat notify flow failed:", e?.message || e);
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

  const docs = await ChatMessage.find(q)
    .sort({ createdAt: -1 })
    .limit(take)
    .lean();
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

  // Try to use Thread collection first (fast)
  try {
    const threads = await Thread.find({
      participants: uid,
      archived: { $ne: true },
    })
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .lean();

    if (Array.isArray(threads) && threads.length) {
      const out = await Promise.all(
        threads.map(async (t) => {
          let peerUid = null;
          if (t.type === "dm" || String(t.room).startsWith("dm:")) {
            const parts = String(t.room).split(":");
            if (parts.length >= 3) {
              const a = parts[1];
              const b = parts[2];
              peerUid = a === uid ? b : b === uid ? a : null;
            }
          } else if (t.type === "booking") {
            // for booking threads, peerUid is ambiguous; leave null or set booking id
            peerUid = null;
          } else {
            // group/system etc.
            peerUid = null;
          }

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
              e?.message || e,
            );
            let unreadCount = 0;
            try {
              unreadCount = await ChatMessage.countDocuments({
                room: t.room,
                toUid: uid,
                seenBy: { $ne: uid },
              });
            } catch {
              unreadCount =
                (t.unreadCounts && Number(t.unreadCounts[uid] || 0)) || 0;
            }
          }

          return {
            room: t.room,
            peerUid,
            lastBody: t.lastMessagePreview || "",
            lastFromUid: t.lastMessageFrom || "",
            lastAt: t.lastMessageAt || t.updatedAt || t.createdAt,
            unreadCount: Number(unreadCount || 0),
          };
        }),
      );

      return out;
    }
  } catch (e) {
    console.warn(
      "[chatService] getInbox(thread) failed, falling back:",
      e?.message || e,
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
        e?.message || e,
      );
    }
  }

  out.sort(
    (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime(),
  );
  return out;
}

/**
 * markThreadRead(peerUid, uid)
 * - marks DM thread between uid & peerUid as seen by uid
 */
export async function markThreadRead(room, uid) {
  if (!room) throw new Error("room required");
  if (!uid) throw new Error("uid required");

  try {
    const res = await ChatMessage.updateMany(
      {
        room,
        seenBy: { $ne: uid },
      },
      { $addToSet: { seenBy: uid } },
    );

    await Thread.markRead(room, uid).catch(() => null);

    const io = getIO();
    io?.to(room).emit("chat:seen", { room, seenBy: uid });

    return { ok: true, updated: res?.modifiedCount ?? 0 };
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
      { room, seenBy: { $ne: uid } },
      { $addToSet: { seenBy: uid } },
    );

    // also update Thread unreadCounts (best-effort)
    try {
      await Thread.markRead(room, uid).catch(() => null);
    } catch (err) {
      console.warn(
        "[chatService] Thread.markRead(room) failed:",
        err?.message || err,
      );
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
        err?.message || err,
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

export async function markAudioPlayed(messageId, uid) {
  if (!messageId) throw new Error("messageId required");
  if (!uid) throw new Error("uid required");

  const doc = await ChatMessage.findById(messageId);
  if (!doc) throw new Error("message_not_found");

  const hasAudio = Array.isArray(doc.attachments)
    ? doc.attachments.some((attachment) =>
        String(attachment?.type || "").toLowerCase().startsWith("audio"),
      )
    : false;

  if (!hasAudio) throw new Error("not_an_audio_message");

  const recipientUid = await resolveMessageRecipient(
    doc.room,
    doc.fromUid,
    doc.toUid,
  );
  if (
    String(uid) !== String(doc.fromUid) &&
    String(uid) !== String(recipientUid)
  ) {
    throw new Error("not_allowed");
  }

  // A sender does not create a recipient playback receipt for their own note.
  let changed = false;
  if (String(doc.fromUid) !== String(uid)) {
    const meta = doc.meta || {};
    const playedBy = Array.isArray(meta.playedBy) ? meta.playedBy : [];
    if (!playedBy.includes(uid)) {
      doc.meta = { ...meta, playedBy: [...playedBy, uid] };
      await doc.save();
      changed = true;
    }
  }

  let payload = buildPayloadFromDoc(doc);
  await attachSender(payload);
  if (changed) getIO()?.to(doc.room).emit("chat:update", payload);

  return { ok: true, changed, message: payload };
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
  markAudioPlayed,
};
