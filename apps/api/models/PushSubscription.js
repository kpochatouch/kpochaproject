//apps/api/models/PushSubscription.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const PushSubscriptionSchema = new Schema(
  {
    ownerUid: { type: String, required: true, index: true },
    deviceId: { type: String, default: "", index: true },
    // The browser subscription object from pushManager.subscribe()
    subscription: { type: Schema.Types.Mixed, required: true },
    // Optional: identify device/browser
    userAgent: { type: String, default: "" },
    // Soft disable instead of deleting (helps debugging)
    disabled: { type: Boolean, default: false, index: true },
    endpoint: { type: String, required: true },
    p256dh: { type: String, default: "" },
    auth: { type: String, default: "" },
  },
  { timestamps: true },
);

PushSubscriptionSchema.index(
  { ownerUid: 1, updatedAt: -1 },
  { name: "owner_updatedAt_idx" },
);

PushSubscriptionSchema.index(
  { ownerUid: 1, endpoint: 1 },
  { unique: true, name: "owner_endpoint_unique" },
);

const PushSubscription =
  mongoose.models.PushSubscription ||
  mongoose.model("PushSubscription", PushSubscriptionSchema);

export default PushSubscription;
