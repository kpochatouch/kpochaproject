// apps/api/models/ChatMessage.js
import mongoose from "mongoose";

const ChatAttachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    type: { type: String, default: "file" }, // "image" | "video" | "file" | ...
    name: { type: String, default: "" },
    size: { type: Number, default: 0 }, // bytes
  },
  { _id: false }
);

const ChatMessageSchema = new mongoose.Schema(
  {
    // Room identifier:
    // - Direct messages: "dm:<uidA>:<uidB>"
    // - Booking chats: "booking:<id>"
    room: { type: String, index: true, required: true },

    // Sender of this message
    fromUid: { type: String, index: true, required: true },

    // Receiver (for DMs). For booking / group-like rooms this can be null.
    toUid: { type: String, index: true },

    // Message text
    body: { type: String, default: "" },

    // Attachments (images, files, etc.)
    attachments: { type: [ChatAttachmentSchema], default: [] },

    // Optional metadata for future extensions
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Read receipts: which user UIDs have viewed this message
    seenBy: { type: [String], default: [] },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// Fast history queries per room (newest first)
ChatMessageSchema.index({ room: 1, createdAt: -1 });

// Fast unread queries for a receiver in a room
ChatMessageSchema.index({ toUid: 1, room: 1, createdAt: -1 });

const ChatMessage =
  mongoose.models.ChatMessage ||
  mongoose.model("ChatMessage", ChatMessageSchema);

export default ChatMessage;
