//apps/api/models/DevicePushToken.js
import mongoose from "mongoose";
const { Schema } = mongoose;

const DevicePushTokenSchema = new Schema(
  {
    ownerUid: { type: String, required: true, index: true },
    platform: {
      type: String,
      enum: ["android", "ios"],
      required: true,
      index: true,
    },

    token: { type: String, required: true },

    deviceId: { type: String, default: "", index: true },

    surfaceType: {
      type: String,
      enum: ["native"],
      default: "native",
      index: true,
    },

    surfaceKey: { type: String, default: "", index: true },

    disabled: { type: Boolean, default: false, index: true },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true },
);

DevicePushTokenSchema.index(
  { ownerUid: 1, platform: 1, token: 1 },
  { unique: true, name: "owner_platform_token_unique" },
);

DevicePushTokenSchema.index(
  { ownerUid: 1, surfaceType: 1, surfaceKey: 1, updatedAt: -1 },
  { name: "owner_native_surface_recent_idx" },
);

export default mongoose.models.DevicePushToken ||
  mongoose.model("DevicePushToken", DevicePushTokenSchema);
