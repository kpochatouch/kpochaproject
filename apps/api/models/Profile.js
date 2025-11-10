// apps/api/models/Profile.js
import mongoose from "mongoose";

const ClientIDSchema = new mongoose.Schema(
  {
    type: { type: String, default: "" },      // e.g. "NIN", "DL"
    numberHash: { type: String, default: "" } // never expose raw number
  },
  { _id: false }
);

/**
 * Single-source profile:
 * - keyed by uid only
 * - lives in "profiles" (because server.js reads that raw collection)
 */
const ClientProfileSchema = new mongoose.Schema(
  {
    uid: { type: String, index: true, required: true },

    fullName: { type: String, default: "" },
    displayName: { type: String, default: "" },
    phone: { type: String, default: "" },
    state: { type: String, default: "" },
    lga: { type: String, default: "" },
    address: { type: String, default: "" },
    photoUrl: { type: String, default: "" },

    id: { type: ClientIDSchema, default: () => ({}) },

    // we keep strict:false so older payloads with identity, kyc, agreements
    // don’t crash — server.js already reads some of those keys.
  },
  {
    timestamps: true,
    strict: false,
    collection: "profiles",
  }
);

// ⛔ no pre-save sync between uid/ownerUid anymore

const ProProfileSchema = new mongoose.Schema(
  {
    // Pro extras stay keyed by ownerUid, that’s fine
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
  {
    timestamps: true,
    strict: false,
  }
);

export const ClientProfile =
  mongoose.models.ClientProfile ||
  mongoose.model("ClientProfile", ClientProfileSchema);

export const ProProfile =
  mongoose.models.ProProfile ||
  mongoose.model("ProProfile", ProProfileSchema);
