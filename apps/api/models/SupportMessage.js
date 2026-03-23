//apps/api/models/SupportMessage.js
import mongoose from "mongoose";

const SupportMessageSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: "SupportSession",
    },

    sender: {
      type: String,
      enum: ["user", "assistant", "agent"],
      required: true,
    },

    text: {
      type: String,
      required: true,
      trim: true,
    },

    readAt: {
      type: Date,
      default: null,
    },

    deliveryStatus: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },
  },
  { timestamps: true },
);

SupportMessageSchema.index({ sessionId: 1, createdAt: 1 });

export default mongoose.model("SupportMessage", SupportMessageSchema);
