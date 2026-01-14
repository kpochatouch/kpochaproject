// apps/api/models/Notification.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Notification model
 *
 * ownerUid: the recipient of the notification (required)
 * actorUid: the initiator (sender / who caused the notification) - optional
 * type: semantic type (chat_message, call_missed, booking_update, follow, system, etc.)
 * seen: whether the user opened/seen the notification in-app
 * readAt: timestamp when seen (nullable)
 * data: payload for the client (room, messageId, bodyPreview, bookingId, callId, etc.)
 * channels: delivery channels status (push, email, sms) - keep booleans + meta for debug
 * priority: optional string/number to order notifications in client
 * groupKey: optional string to group similar notifications (e.g., "chat:room:<id>") for grouping UI
 */
const NotificationSchema = new Schema(
  {
    ownerUid: { type: String, required: true, index: true }, // receiver
    actorUid: { type: String, default: "", index: true }, // initiator (sender)
    type: {
      type: String,
      required: true,
      index: true,
    },

    // Lightweight seen/read fields
    seen: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },

    // Payload for client rendering / deep linking
    data: { type: Schema.Types.Mixed, default: {} },

    // Delivery channel flags and metadata
    deliveredPush: { type: Boolean, default: false },
    deliveredEmail: { type: Boolean, default: false },
    deliveredSms: { type: Boolean, default: false },

    // Optional: additional meta for debugging or provider ids
    meta: { type: Schema.Types.Mixed, default: {} },

    // Optional grouping key to collapse multiple notifications into one in the UI
    groupKey: { type: String, default: null, index: true },

    // Priority: "low" | "default" | "high" or numeric
    priority: {
      type: String,
      enum: ["low", "default", "high"],
      default: "default",
    },

    // Soft-delete in case you want to archive/cleanup notifications without removing DB row
    deleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true, // createdAt, updatedAt
  },
);

/**
 * Indexes:
 * - ownerUid, createdAt for listing a user's notifications quickly
 * - ownerUid + seen for fast unread counts
 * - type + ownerUid for bulk ops and analytics
 * - groupKey helps grouping queries (collapse chat message spams)
 */
NotificationSchema.index(
  { ownerUid: 1, createdAt: -1 },
  { name: "owner_createdAt_idx" },
);
NotificationSchema.index({ ownerUid: 1, seen: 1 }, { name: "owner_seen_idx" });
NotificationSchema.index({ type: 1, ownerUid: 1 }, { name: "type_owner_idx" });

/**
 * Instance helpers
 */
NotificationSchema.methods.markSeen = async function () {
  if (!this.seen) {
    this.seen = true;
    this.readAt = new Date();
    await this.save();
  }
  return this;
};

NotificationSchema.methods.markDelivered = async function (
  channel = "push",
  providerMeta = {},
) {
  if (!channel) return this;
  if (channel === "push") this.deliveredPush = true;
  else if (channel === "email") this.deliveredEmail = true;
  else if (channel === "sms") this.deliveredSms = true;

  // attach provider metadata to meta.deliveries for traceability
  const deliveries =
    this.meta && this.meta.deliveries ? this.meta.deliveries : [];
  deliveries.push({ channel, providerMeta, at: new Date() });
  this.meta = { ...this.meta, deliveries };
  await this.save();
  return this;
};

/**
 * Static helpers
 */
NotificationSchema.statics.unreadCountFor = async function (uid) {
  if (!uid) return 0;
  return this.countDocuments({ ownerUid: uid, seen: false, deleted: false });
};

/**
 * Soft-delete helper
 */
NotificationSchema.methods.softDelete = async function () {
  this.deleted = true;
  await this.save();
  return this;
};

const Notification =
  mongoose.models.Notification ||
  mongoose.model("Notification", NotificationSchema);

export default Notification;
