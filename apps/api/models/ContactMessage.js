//apps/api/models/ContactMessage.js
import mongoose from "mongoose";

const ContactMessageSchema = new mongoose.Schema(
  {
    userUid: {
      type: String,
      default: "",
      index: true,
    },

    name: {
      type: String,
      default: "",
      trim: true,
    },

    email: {
      type: String,
      default: "",
      trim: true,
    },

    phone: {
      type: String,
      default: "",
      trim: true,
    },

    subject: {
      type: String,
      default: "",
      trim: true,
    },

    message: {
      type: String,
      default: "",
      trim: true,
    },

    source: {
      type: String,
      default: "contact_form",
    },
  },
  { timestamps: true },
);

ContactMessageSchema.index({ createdAt: -1 });

export default mongoose.model("ContactMessage", ContactMessageSchema);
