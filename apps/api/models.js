// apps/api/models.js
import mongoose from "mongoose";

/* ------------------------------ Applications ------------------------------ */
/** Holds full application payload (identity/professional/bank/etc.)
 *  plus optional withdraw PIN hash used by wallet flows.
 *  We keep strict:false so we can store whatever the web app sends.
 */
const ApplicationSchema = new mongoose.Schema(
  {
    uid: { type: String, index: true, required: true },
    email: { type: String, index: true },

    // quick fields for Admin list
    displayName: { type: String, default: "" },
    phone: { type: String, default: "" },
    lga: { type: String, default: "" },
    services: { type: String, default: "" },

    // wallet withdraw PIN (hashed)
    withdrawPinHash: { type: String, default: null },

    status: {
      type: String,
      enum: ["pending", "submitted", "approved", "rejected"],
      default: "submitted",
      index: true,
    },

    rejectedReason: { type: String, default: "" }, // optional admin note
    clientId: { type: String, index: true },       // optional dev helper id
  },
  {
    timestamps: true,
    strict: false, // keep full payload as-is
  }
);

/* ----------------------------------- Pros ---------------------------------- */
/** Rich Pro schema. strict:false lets us attach identity/professional/bank/etc.
 *  Optional GeoJSON 'loc' + 2dsphere index supports /api/barbers/nearby.
 */
const ServiceItemSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },               // optional stable id for client diffing
    name: { type: String, required: true },
    price: { type: Number, default: 0 },             // NGN
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
    // 🔁 Start at zero — no fake 4.8 anywhere
    avgRating: { type: Number, default: 0 },
    recentDeclines: { type: Number, default: 0 },
    totalStrikes: { type: Number, default: 0 },
    lastDecisionAt: { type: Date, default: null },

    // placeholders for future analytics/ranking/rewards
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    rankScore: { type: Number, default: 0 },
    rewardPoints: { type: Number, default: 0 },
  },
  { _id: false }
);

const ProSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, unique: true, index: true },

    name: { type: String, required: true },

    // geo filters
    lga: { type: String, index: true },
    state: { type: String, default: "" },

    // Optional GeoJSON point for nearby search
    loc: {
      type: {
        type: String,
        enum: ["Point"],
        default: undefined,
      },
      coordinates: {
        type: [Number], // [lon, lat]
        default: undefined,
      },
    },

    // availability can be string ("Available") or a rich object
    availability: { type: mongoose.Schema.Types.Mixed, default: "Available" },

    // 🔁 Legacy field should not pretend to be 4.8 by default
    rating: { type: Number, default: 0 },

    services: { type: [ServiceItemSchema], default: [] },

    profileVisible: { type: Boolean, default: true },

    contactPublic: { type: ContactPublicSchema, default: () => ({}) },
    contactPrivate: { type: ContactPrivateSchema, default: () => ({}) },

    gallery: { type: [String], default: [] },
    badges: { type: [BadgeSchema], default: [] },

    metrics: { type: MetricsSchema, default: () => ({}) },

    // With strict:false we may also store:
    // identity, professional, availability (object), bank, etc.
  },
  {
    timestamps: true,
    strict: false,
  }
);

// Helpful indexes
ProSchema.index({ profileVisible: 1, lga: 1 });
ProSchema.index({ "services.name": 1 });
ProSchema.index({ "services.id": 1 });
ProSchema.index({ loc: "2dsphere" }); // used by $geoNear

// Normalize LGA casing on save (keeps filters reliable)
ProSchema.pre("save", function normalizeLga(next) {
  if (this.lga) this.lga = String(this.lga).toUpperCase();
  next();
});

/* ---------------------------- Public mapper (safe) -------------------------- */
/** SAFE mapper used by /api/barbers – hides private fields and filters services
 *  Also returns a star helper for UI:
 *  - rating: real numeric average (0..5)
 *  - ratingStars: { full: 0..5, empty: 0..5 }  // always totals 5 for grey-star bars
 */
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

  // 🧮 Determine the true rating:
  // prefer metrics.avgRating if it exists (>0), otherwise legacy rating (>0), else 0
  let rating = 0;
  const metricsAvg = Number(d?.metrics?.avgRating);
  if (Number.isFinite(metricsAvg) && metricsAvg > 0) {
    rating = metricsAvg;
  } else if (Number.isFinite(d?.rating) && d.rating > 0) {
    rating = Number(d.rating);
  }

  // Clamp to 0..5 and round to one decimal for display
  rating = Math.max(0, Math.min(5, rating));
  const ratingRounded = Math.round(rating * 10) / 10;

  // Build a 5-star helper (whole-star fill; UI can render empty stars in grey)
  const fullStars = Math.floor(ratingRounded); // 0..5
  const emptyStars = 5 - fullStars;            // complements to 5

  return {
    id: d._id?.toString?.() || String(d._id || ""),
    name: d.name || "",
    lga: (d.lga || "").toString().toUpperCase(),
    availability: d.availability || "Available",

    // 🔁 Numeric rating (0..5). Will be 0 if no reviews yet.
    rating: ratingRounded,

    // ⭐ Five-star helper for grey bar rendering in UI
    ratingStars: {
      full: fullStars,
      empty: emptyStars,
    },

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

/* -------------------------------------------------------------------------- */
/* COMMENTARY (for quick understanding)
   - Removed fake 4.8 defaults everywhere (now both metrics.avgRating and
     Pro.rating default to 0).
   - Mapper prefers metrics.avgRating; falls back to legacy Pro.rating; else 0.
   - Mapper always returns rating in [0..5] and an easy `ratingStars` object
     so the frontend can paint 5 grey stars and fill `full` of them.
   - No DB wipe is required; once deployed, cards stop showing fake 4.8.
*/
/* -------------------------------------------------------------------------- */
