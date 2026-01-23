//apps/api/models/PushSubscription.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const PushSubscriptionSchema = new Schema(
  {
    ownerUid: { type: String, required: true, index: true },
    // The browser subscription object from pushManager.subscribe()
    subscription: { type: Schema.Types.Mixed, required: true },
    // Optional: identify device/browser
    userAgent: { type: String, default: "" },
    // Soft disable instead of deleting (helps debugging)
    disabled: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

PushSubscriptionSchema.index(
  { ownerUid: 1, updatedAt: -1 },
  { name: "owner_updatedAt_idx" },
);

const PushSubscription =
  mongoose.models.PushSubscription ||
  mongoose.model("PushSubscription", PushSubscriptionSchema);

export default PushSubscription;
