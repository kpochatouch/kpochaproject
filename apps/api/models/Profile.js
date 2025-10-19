// apps/api/models/Profile.js
import mongoose from "mongoose";

const ClientIDSchema = new mongoose.Schema(
  {
    type: { type: String, default: "" },      // e.g. "NIN", "DL"
    numberHash: { type: String, default: "" } // never expose raw number
  },
  { _id: false }
);

const ClientProfileSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, unique: true, index: true },
    fullName: { type: String, default: "" },
    phone: { type: String, default: "" },
    state: { type: String, default: "" },
    lga: { type: String, default: "" },
    address: { type: String, default: "" },
    photoUrl: { type: String, default: "" },
    id: { type: ClientIDSchema, default: () => ({}) },
  },
  { timestamps: true, strict: false } // accept extra harmless fields
);

const ProProfileSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, unique: true, index: true },
    proId: { type: mongoose.Schema.Types.ObjectId, ref: "Pro", index: true },
    shopAddress: { type: String, default: "" },
    shopPhone: { type: String, default: "" },
    whatsapp: { type: String, default: "" },
    bio: { type: String, default: "" },
    gallery: { type: [String], default: [] },
    privateAddress: { type: String, default: "" }, // never returned publicly
    verified: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false }
);

export const ClientProfile =
  mongoose.models.ClientProfile ||
  mongoose.model("ClientProfile", ClientProfileSchema);

export const ProProfile =
  mongoose.models.ProProfile ||
  mongoose.model("ProProfile", ProProfileSchema);
