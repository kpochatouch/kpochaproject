// apps/api/models/Notification.js
import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, index: true }, // who receives
    actorUid: { type: String, default: "" },                 // who caused it
    type: { type: String, required: true, index: true },     // e.g. "follow","comment","booking"
    seen: { type: Boolean, default: false, index: true },    // read/unread
    data: { type: mongoose.Schema.Types.Mixed, default: {} },// payload (ids, text, links)
    deliveredPush: { type: Boolean, default: false },        // optional push flag
    deliveredEmail: { type: Boolean, default: false },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },// extra (priority, ttl)
  },
  { timestamps: true }
);

NotificationSchema.index({ ownerUid: 1, createdAt: -1 });
NotificationSchema.index({ ownerUid: 1, seen: 1 });

const Notification =
  mongoose.models.Notification || mongoose.model("Notification", NotificationSchema);

export default Notification;
