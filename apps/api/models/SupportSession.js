//apps/api/models/SupportSession.js
import mongoose from "mongoose";

const SupportSessionSchema = new mongoose.Schema(
  {
    userUid: {
      type: String,
      required: true,
      index: true,
    },

    mode: {
      type: String,
      enum: ["bot", "human"],
      default: "bot",
      required: true,
    },

    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      required: true,
    },

    escalated: {
      type: Boolean,
      default: false,
      required: true,
    },

    escalatedAt: {
      type: Date,
      default: null,
    },

    lastMessageAt: {
      type: Date,
      default: null,
    },

    lastMessageText: {
      type: String,
      default: "",
    },

    lastSender: {
      type: String,
      enum: ["", "user", "assistant", "agent"],
      default: "",
    },

    unreadAdminCount: {
      type: Number,
      default: 0,
      required: true,
    },

    unreadUserCount: {
      type: Number,
      default: 0,
      required: true,
    },
  },
  { timestamps: true },
);

SupportSessionSchema.index({ userUid: 1, status: 1 });
SupportSessionSchema.index({
  escalated: 1,
  mode: 1,
  status: 1,
  lastMessageAt: -1,
});

export default mongoose.model("SupportSession", SupportSessionSchema);
