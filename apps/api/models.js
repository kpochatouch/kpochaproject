// apps/api/models.js
import mongoose from "mongoose";

/* -------------------------------- Applications ------------------------------ */
/** Minimal application doc + withdraw PIN hash (bcrypt) kept here.
 *  This remains the source doc you upsert from BecomePro/etc.
 */
const ApplicationSchema = new mongoose.Schema(
  {
    uid: { type: String, index: true, required: true },
    email: { type: String, index: true },

    // legacy “quick apply” fields
    displayName: { type: String, default: "" },
    phone: { type: String, default: "" },
    lga: { type: String, default: "" },
    services: { type: String, default: "" },

    // wallet withdraw PIN (hashed)
    withdrawPinHash: { type: String, default: null },

    status: { type: String, default: "pending", index: true },
    clientId: { type: String, index: true }, // dev helper id
  },
  { timestamps: true }
);

/* ---------------------------------- Pros ----------------------------------- */
/** Richer Pro schema; back-compat with your UI:
 *  - keeps `rating` but prefers metrics.avgRating for public.
 *  - services array supports visibility and optional ids.
 */
const ServiceItemSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" }, // optional stable id
    name: { type: String, required: true },
    price: { type: Number, default: 0 }, // NGN; convert to kobo when booking
    visible: { type: Boolean, default: true },
    description: { type: String, default: "" },
    durationMins: { type: Number, default: 0 },
  },
  { _id: false }
);

const ContactPublicSchema = new mongoose.Schema(
  {
    phone: { type: String, default: "" },
    shopName: { type: String, default: "" },
    shopAddress: { type: String, default: "" },
  },
  { _id: false }
);

const ContactPrivateSchema = new mongoose.Schema(
  {
    homeAddress: { type: String, default: "" }, // never expose publicly
    altPhone: { type: String, default: "" },
  },
  { _id: false }
);

const BadgeSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["verified", "top_rated", "featured", "new"], default: "verified" },
    label: { type: String, default: "" },
  },
  { _id: false }
);

const MetricsSchema = new mongoose.Schema(
  {
    totalReviews: { type: Number, default: 0 },
    avgRating: { type: Number, default: 4.8 },
    recentDeclines: { type: Number, default: 0 },
    totalStrikes: { type: Number, default: 0 },
    lastDecisionAt: { type: Date, default: null },
  },
  { _id: false }
);

const ProSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, index: true, required: true },
    name: { type: String, required: true },

    // geo (keep 'lga' name to match Browse/UI)
    lga: { type: String, index: true },
    state: { type: String, default: "" },

    availability: { type: String, default: "Available" },
    rating: { type: Number, default: 4.8 }, // legacy field

    services: { type: [ServiceItemSchema], default: [] },

    profileVisible: { type: Boolean, default: true },

    contactPublic: { type: ContactPublicSchema, default: () => ({}) },
    contactPrivate: { type: ContactPrivateSchema, default: () => ({}) },

    gallery: { type: [String], default: [] },
    badges: { type: [BadgeSchema], default: [] },

    metrics: { type: MetricsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// Helpful indexes
ProSchema.index({ profileVisible: 1, lga: 1 });
ProSchema.index({ "services.name": 1 });
ProSchema.index({ "services.id": 1 });

// Normalize LGA casing on save (keeps filters reliable)
ProSchema.pre("save", function normalizeLga(next) {
  if (this.lga) this.lga = String(this.lga).toUpperCase();
  next();
});

/* ------------------------------- Public mapper ----------------------------- */
/** SAFE mapper used by /api/barbers – hides private fields and filters services */
export function proToBarber(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;

  const normalizedServices = Array.isArray(d?.services)
    ? d.services
        .filter((s) => (typeof s?.visible === "boolean" ? s.visible : true))
        .map((s) => ({
          name: s?.name || "",
          price: Number.isFinite(s?.price) ? s.price : 0,
        }))
    : [];

  return {
    id: d._id?.toString?.() || String(d._id || ""),
    name: d.name || "",
    lga: (d.lga || "").toString().toUpperCase(),
    availability: d.availability || "Available",
    rating: Number.isFinite(d?.metrics?.avgRating) ? d.metrics.avgRating : Number(d?.rating || 0),
    services: normalizedServices,
    shopName: d?.contactPublic?.shopName || "",
    shopAddress: d?.contactPublic?.shopAddress || "",
    phone: d?.contactPublic?.phone || "",
    badges: Array.isArray(d?.badges) ? d.badges.map((b) => b.label || b.kind).filter(Boolean) : [],
    gallery: Array.isArray(d?.gallery) ? d.gallery : [],
  };
}

/* --------------------------------- Exports --------------------------------- */
export const Application =
  mongoose.models.Application || mongoose.model("Application", ApplicationSchema);

export const Pro =
  mongoose.models.Pro || mongoose.model("Pro", ProSchema);
