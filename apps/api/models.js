



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
    clientId: { type: String, index: true }, // optional dev helper id
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
    id: { type: String, default: "" }, // optional stable id for client diffing
    name: { type: String, required: true },
    price: { type: Number, default: 0 }, // NGN
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
    kind: {
      type: String,
      enum: ["verified", "top_rated", "featured", "new"],
      default: "verified",
    },
    label: { type: String, default: "" },
  },
  { _id: false }
);

const MetricsSchema = new mongoose.Schema(
  {
    totalReviews: { type: Number, default: 0 },
    // start at 0 — we don't want fake 4.8s
    avgRating: { type: Number, default: 0 },
    recentDeclines: { type: Number, default: 0 },
    totalStrikes: { type: Number, default: 0 },
    lastDecisionAt: { type: Date, default: null },

    // future analytics
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

    // legacy rating field — we won't trust it if there are no reviews
    rating: { type: Number, default: 0 },

    // current location for services
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
ProSchema.index({ profileVisible: 1, state: 1 });         // ← add this
ProSchema.index({ profileVisible: 1, state: 1, lga: 1 }); // ← optional but nice for state+LGA
ProSchema.index({ "services.name": 1 });
ProSchema.index({ "services.id": 1 });
ProSchema.index({ loc: "2dsphere" }); // used by $geoNear

// Normalize LGA + state casing on save (keeps filters reliable)
ProSchema.pre("save", function normalizeLocation(next) {
  if (this.lga) this.lga = String(this.lga).toUpperCase();
  if (this.state) this.state = String(this.state).toUpperCase();
  next();
});

/* ---------------------------- Public mapper (safe) -------------------------- */
/**
 * SAFE mapper used by /api/barbers.
 *
 * ROOT FIXES:
 * 1. We will ONLY show a rating if there is at least 1 real review
 *    (metrics.totalReviews > 0). If not, rating=0 and 5 empty stars.
 * 2. We will surface services from multiple legacy places:
 *    - pro.services
 *    - pro.professional.services
 *    so the drawer stops saying "This pro has not listed services yet."
 */
export function proToBarber(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;

  /* ----- 1) pick up services from wherever they were saved ----- */
  let rawServices = Array.isArray(d?.services) ? d.services : [];

  // legacy location from older application payloads
  if ((!rawServices || rawServices.length === 0) && d?.professional) {
    if (Array.isArray(d.professional.services)) {
      rawServices = d.professional.services;
    } else if (Array.isArray(d.professional.serviceList)) {
      rawServices = d.professional.serviceList;
    }
  }

  const normalizedServices = Array.isArray(rawServices)
    ? rawServices
        .filter((s) => (typeof s?.visible === "boolean" ? s.visible : true))
        .map((s) => ({
          name: s?.name || "",
          price: Number.isFinite(s?.price) ? s.price : 0,
        }))
        .filter((s) => s.name) // remove blanks
    : [];

  /* ----- 2) rating: show NOTHING unless there is a real review ----- */
  const totalReviews = Number(d?.metrics?.totalReviews || 0);
  const hasRealReviews = totalReviews > 0;

  let rating = 0;
  if (hasRealReviews) {
    // only trust rating when we actually have reviews
    const metricsAvg = Number(d?.metrics?.avgRating);
    if (Number.isFinite(metricsAvg) && metricsAvg > 0) {
      rating = metricsAvg;
    } else if (Number.isFinite(d?.rating) && d.rating > 0) {
      rating = Number(d.rating);
    }
  }

  // clamp + round
  rating = Math.max(0, Math.min(5, rating));
  const ratingRounded = Math.round(rating * 10) / 10;

  // build star helper
  const fullStars = hasRealReviews ? Math.floor(ratingRounded) : 0;
  const emptyStars = 5 - fullStars;

  /* ----- 3) final public shape ----- */
  return {
    id: d._id?.toString?.() || String(d._id || ""),
    name: d.name || "",
    lga: (d.lga || "").toString().toUpperCase(),
    state: (d.state || "").toString().toUpperCase(),
    availability: d.availability || "Available",

    // will be 0 if there are no reviews → frontend should hide/grey it
    rating: hasRealReviews ? ratingRounded : 0,

    ratingStars: {
      full: fullStars,
      empty: emptyStars,
    },

    services: normalizedServices,
    shopName: d?.contactPublic?.shopName || "",
    shopAddress: d?.contactPublic?.shopAddress || "",
    phone: d?.contactPublic?.phone || "",
    badges: Array.isArray(d?.badges)
      ? d.badges.map((b) => b.label || b.kind).filter(Boolean)
      : [],
    gallery: Array.isArray(d?.gallery) ? d.gallery : [],
    metrics: d.metrics || {},
  };
}

/* --------------------------------- Exports --------------------------------- */
export const Application =
  mongoose.models.Application ||
  mongoose.model("Application", ApplicationSchema);

export const Pro =
  mongoose.models.Pro || mongoose.model("Pro", ProSchema);

/* -------------------------------------------------------------------------- */
/* SUMMARY
   - if metrics.totalReviews is 0 or missing → API sends rating: 0 and 0 full stars
   - services are pulled from pro.services OR pro.professional.services
   - this removes old / hardcoded-looking 4.8s from the API layer
*/
/* -------------------------------------------------------------------------- */
