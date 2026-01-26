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
    disabled: { type: Boolean, default: false, index: true },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true },
);

DevicePushTokenSchema.index(
  { ownerUid: 1, platform: 1, token: 1 },
  { unique: true, name: "owner_platform_token_unique" },
);

export default mongoose.models.DevicePushToken ||
  mongoose.model("DevicePushToken", DevicePushTokenSchema);
