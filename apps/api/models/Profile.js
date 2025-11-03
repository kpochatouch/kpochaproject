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
 * IMPORTANT:
 * - server.js and some routes read the raw Mongo collection "profiles" with { uid: ... }
 * - some newer code started using { ownerUid: ... }
 * So we support BOTH here, and we force the collection name to "profiles".
 */
const ClientProfileSchema = new mongoose.Schema(
  {
    // support both keys so old and new code see the same document
    uid: { type: String, index: true },
    ownerUid: { type: String, index: true },

    fullName: { type: String, default: "" },
    phone: { type: String, default: "" },
    state: { type: String, default: "" },
    lga: { type: String, default: "" },
    address: { type: String, default: "" },
    photoUrl: { type: String, default: "" },
    id: { type: ClientIDSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    strict: false,
    collection: "profiles", // must match what server.js reads directly
  }
);

// keep uid/ownerUid in sync so raw queries always find the doc
ClientProfileSchema.pre("save", function (next) {
  if (!this.uid && this.ownerUid) {
    this.uid = this.ownerUid;
  }
  if (!this.ownerUid && this.uid) {
    this.ownerUid = this.uid;
  }
  next();
});

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
  {
    timestamps: true,
    strict: false,
    // default collection is fine here
  }
);

export const ClientProfile =
  mongoose.models.ClientProfile ||
  mongoose.model("ClientProfile", ClientProfileSchema);

export const ProProfile =
  mongoose.models.ProProfile ||
  mongoose.model("ProProfile", ProProfileSchema);
