// apps/api/models/ChatMessage.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Attachment subdocument
 */
const ChatAttachmentSchema = new Schema(
  {
    url: { type: String, required: true },
    type: { type: String, default: "file" }, // "image" | "video" | "audio" | "file" | ...
    name: { type: String, default: "" },
    size: { type: Number, default: 0 }, // bytes
    mime: { type: String, default: "" },
  },
  { _id: false }
);

/**
 * Main ChatMessage schema
 */
const ChatMessageSchema = new Schema(
  {
    // Room identifier:
    // - Direct messages: "dm:<minUid>:<maxUid>" (normalize order)
    // - Booking chats: "booking:<id>"
    room: { type: String, required: true },

    // Sender UID (Firebase UID or canonical uid string)
    fromUid: { type: String, required: true },

    // Receiver (for 1:1 DMs). For group/booking rooms this can be null.
    toUid: { type: String, default: null },

    // Client-provided id for dedupe / optimistic UI (sparse to avoid null bloat)
    clientId: { type: String, default: null },

    // Message body / text
    body: { type: String, default: "" },

    // Message category/type (helps UI decide how to render)
    messageType: {
      type: String,
      enum: ["text", "image", "video", "audio", "file", "system", "call"],
      default: "text",
    },

    // Attachments (images, files, etc.)
    attachments: { type: [ChatAttachmentSchema], default: [] },

    // Reply thread pointer (single-level reply)
    replyTo: { type: Schema.Types.ObjectId, ref: "ChatMessage", default: null },

    // Duration (seconds) for audio messages / call summaries
    duration: { type: Number, default: 0 },

    // Soft-delete + edit flags
    edited: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },

    // Read receipts: store UIDs who have seen this message (good for small groups; move to read-receipt collection for large groups)
    seenBy: { type: [String], default: [] },

    // Reactions: Map<emoji, Array<uid>>
    // NOTE: Mongoose Map with array values — convenient for quick lookups.
    reactions: {
      type: Map,
      of: [String],
      default: {},
    },

    // Free-form metadata (for stamps, transcripts, waveforms, etc.)
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true, // createdAt, updatedAt
    minimize: false, // preserve empty objects like meta
  }
);

/**
 * Indexes
 *
 * - Most reads are by room + createdAt (newest first).
 * - Partial index for active (not deleted) messages to keep queries fast.
 * - Sparse clientId index to allow dedupe only when clientId is present (avoids nulls).
 * - Index to find messages for a particular recipient in a room (useful for unread queries).
 */
ChatMessageSchema.index(
  { room: 1, createdAt: -1 },
  { name: "room_createdAt_idx", partialFilterExpression: { deleted: { $ne: true } } }
);

ChatMessageSchema.index(
  { toUid: 1, room: 1, createdAt: -1 },
  { name: "to_room_createdAt_idx", partialFilterExpression: { deleted: { $ne: true } } }
);

ChatMessageSchema.index(
  { room: 1, fromUid: 1, clientId: 1 },
  { name: "client_dedupe_idx", sparse: true }
);

// Optional index for quick lookups by sender + recent messages
ChatMessageSchema.index({ fromUid: 1, createdAt: -1 }, { name: "from_createdAt_idx" });

/**
 * Instance helpers
 */
ChatMessageSchema.methods.markSeen = async function (uid) {
  if (!uid) return this;
  if (this.seenBy && this.seenBy.includes(uid)) return this;
  this.seenBy.push(uid);
  await this.save();
  return this;
};

ChatMessageSchema.methods.addReaction = async function (emoji, uid) {
  if (!emoji || !uid) return this;
  const arr = this.reactions.get(emoji) || [];
  if (!arr.includes(uid)) {
    arr.push(uid);
    this.reactions.set(emoji, arr);
    await this.save();
  }
  return this;
};

ChatMessageSchema.methods.removeReaction = async function (emoji, uid) {
  if (!emoji || !uid) return this;
  const arr = this.reactions.get(emoji) || [];
  const idx = arr.indexOf(uid);
  if (idx !== -1) {
    arr.splice(idx, 1);
    if (arr.length === 0) this.reactions.delete(emoji);
    else this.reactions.set(emoji, arr);
    await this.save();
  }
  return this;
};

/**
 * Static helpers
 */
ChatMessageSchema.statics.createDMRoom = function (uidA, uidB) {
  // canonicalize order so same pair always results in same room id
  if (!uidA || !uidB) throw new Error("uids required");
  if (uidA === uidB) return `dm:${uidA}`;
  const [a, b] = uidA < uidB ? [uidA, uidB] : [uidB, uidA];
  return `dm:${a}:${b}`;
};

/**
 * Pre-save validations / normalization
 */
ChatMessageSchema.pre("save", function (next) {
  // Prevent huge attachments arrays
  if (this.attachments && this.attachments.length > 20) {
    return next(new Error("attachments array too large (max 20)"));
  }

  // Normalize empty clientId -> null (keeps sparse index behavior consistent)
  if (!this.clientId) this.clientId = null;

  // If messageType is non-text and there's no attachments, allow but warn via meta (optional)
  next();
});

/**
 * Considerations:
 * - For group chats with many participants, move read receipts to a separate collection:
 *   { room, uid, lastSeenAt } to avoid unbounded seenBy arrays on messages.
 * - For very high scale, consider sharding by hashed(room).
 */
const ChatMessage =
  mongoose.models.ChatMessage || mongoose.model("ChatMessage", ChatMessageSchema);

export default ChatMessage;
