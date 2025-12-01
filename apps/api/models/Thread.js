// apps/api/models/Thread.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Thread (Conversation) model
 *
 * - room: canonical room string (dm:<a>:<b> | booking:<id> | call:<id> | group:<id>)
 * - type: "dm" | "booking" | "call" | "group" | "system"
 * - participants: [ uid ]
 * - bookingId: optional ObjectId (if booking thread)
 * - lastMessageAt/lastMessageId/lastMessagePreview: for fast inbox sorting
 * - unreadCounts: Map<uid, Number> or an object { uid: count }
 * - pinned: [uid] optional
 */
const ThreadSchema = new Schema(
  {
    room: { type: String, required: true, unique: true, index: true },
    type: {
      type: String,
      enum: ["dm", "booking", "call", "group", "system"],
      default: "dm",
      index: true,
    },
    participants: { type: [String], default: [] }, // array of UIDs
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", default: null, index: true },

    // Last message snapshot for inbox
    lastMessageId: { type: Schema.Types.ObjectId, ref: "ChatMessage", default: null },
    lastMessageAt: { type: Date, default: null, index: true },
    lastMessagePreview: { type: String, default: "" },
    lastMessageFrom: { type: String, default: "" },

    // Unread counters map stored as an object for quick reads
    // Example: { "<uid1>": 2, "<uid2>": 0 }
    unreadCounts: { type: Schema.Types.Mixed, default: () => ({}) },

    // Optional metadata
    title: { type: String, default: "" }, // group title or friendly name
    pinnedBy: { type: [String], default: [] },
    archived: { type: Boolean, default: false },

    meta: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  }
);

/* Indexes */
ThreadSchema.index({ participants: 1, lastMessageAt: -1 });
ThreadSchema.index({ archived: 1, lastMessageAt: -1 });

/* ------------------ Statics / Helpers ------------------ */

/**
 * DM canonical room builder (same logic as ChatMessage.createDMRoom)
 * call: Thread.createDMRoom(uidA, uidB)
 */
ThreadSchema.statics.createDMRoom = function (uidA, uidB) {
  if (!uidA || !uidB) throw new Error("uids required");
  if (uidA === uidB) return `dm:${uidA}`;
  const [a, b] = uidA < uidB ? [uidA, uidB] : [uidB, uidA];
  return `dm:${a}:${b}`;
};

/**
 * Create or get thread for a DM pair.
 * Returns the thread doc (new or existing).
 */
ThreadSchema.statics.getOrCreateDMThread = async function (uidA, uidB) {
  const room = this.createDMRoom(uidA, uidB);
  const existing = await this.findOne({ room }).lean();
  if (existing) return existing;

  const participants = Array.from(new Set([String(uidA), String(uidB)])).filter(Boolean);
  const t = await this.create({
    room,
    type: "dm",
    participants,
    lastMessageAt: null,
  });
  return t.toObject ? t.toObject() : t;
};

/**
 * Create or get thread for a booking
 */
ThreadSchema.statics.getOrCreateBookingThread = async function (bookingId) {
  if (!bookingId) throw new Error("bookingId required");
  const room = `booking:${String(bookingId)}`;
  const existing = await this.findOne({ room }).lean();
  if (existing) return existing;

  const t = await this.create({
    room,
    type: "booking",
    bookingId,
    participants: [],
    lastMessageAt: null,
  });
  return t.toObject ? t.toObject() : t;
};

/**
 * Update last message snapshot and increment unread for recipients
 *
 * options:
 *  - lastMessageId
 *  - lastMessageAt
 *  - lastMessagePreview
 *  - lastMessageFrom
 *  - incrementFor: array of uids to increment unread for (defaults: all participants except sender)
 */
ThreadSchema.statics.touchLastMessage = async function (room, opts = {}) {
  if (!room) throw new Error("room required");
  const {
    lastMessageId = null,
    lastMessageAt = new Date(),
    lastMessagePreview = "",
    lastMessageFrom = "",
    incrementFor = null,
  } = opts;

  const thread = await this.findOne({ room });
  if (!thread) {
    // create a minimal thread if missing
    const created = await this.create({
      room,
      type: room.startsWith("dm:") ? "dm" : room.startsWith("booking:") ? "booking" : "group",
      participants: [],
      lastMessageAt,
      lastMessageId,
      lastMessagePreview,
      lastMessageFrom,
    });
    // set unread counts if requested
    if (Array.isArray(incrementFor) && incrementFor.length) {
      const map = {};
      incrementFor.forEach((u) => {
        map[u] = (map[u] || 0) + 1;
      });
      created.unreadCounts = map;
      await created.save();
    }
    return created;
  }

  // update snapshot
  thread.lastMessageId = lastMessageId || thread.lastMessageId;
  thread.lastMessageAt = lastMessageAt || thread.lastMessageAt || new Date();
  thread.lastMessagePreview =
    typeof lastMessagePreview === "string" && lastMessagePreview.length
      ? lastMessagePreview.slice(0, 255)
      : thread.lastMessagePreview;
  thread.lastMessageFrom = lastMessageFrom || thread.lastMessageFrom;

  // increment unread counters
  const incFor = Array.isArray(incrementFor)
    ? incrementFor
    : thread.participants.filter((u) => u && u !== lastMessageFrom);

  thread.unreadCounts = thread.unreadCounts || {};
  for (const u of incFor) {
    if (!u) continue;
    thread.unreadCounts[u] = (Number(thread.unreadCounts[u] || 0) || 0) + 1;
  }

  await thread.save();
  return thread;
};

/**
 * Mark thread as read for a uid (zero the unread counter)
 */
ThreadSchema.statics.markRead = async function (room, uid) {
  if (!room || !uid) throw new Error("room & uid required");
  const t = await this.findOne({ room });
  if (!t) return null;
  if (!t.unreadCounts) t.unreadCounts = {};
  if (t.unreadCounts[uid]) {
    t.unreadCounts[uid] = 0;
    await t.save();
  }
  return t;
};

/* ------------------ Instance helpers ------------------ */

ThreadSchema.methods.addParticipant = async function (uid) {
  if (!uid) return this;
  this.participants = Array.from(new Set([...(this.participants || []), uid]));
  await this.save();
  return this;
};

ThreadSchema.methods.removeParticipant = async function (uid) {
  if (!uid) return this;
  this.participants = (this.participants || []).filter((u) => u !== uid);
  await this.save();
  return this;
};

const Thread = mongoose.models.Thread || mongoose.model("Thread", ThreadSchema);
export default Thread;
