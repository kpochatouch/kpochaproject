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
  },
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
  { _id: false },
);

const ContactPublicSchema = new mongoose.Schema(
  {
    phone: { type: String, default: "" },
    shopName: { type: String, default: "" },
    shopAddress: { type: String, default: "" },
  },
  { _id: false },
);

const ContactPrivateSchema = new mongoose.Schema(
  {
    homeAddress: { type: String, default: "" }, // never expose publicly
    altPhone: { type: String, default: "" },
  },
  { _id: false },
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
  { _id: false },
);

const MetricsSchema = new mongoose.Schema(
  {
    totalReviews: { type: Number, default: 0 },
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
  { _id: false },
);

const ProSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, required: true, unique: true, index: true },

    name: { type: String, required: true },

    // main display image for barber card
    photoUrl: { type: String, default: "" },

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
  },
);

// Helpful indexes (these make /api/barbers?state=... or ?lga=... faster)
ProSchema.index({ profileVisible: 1, lga: 1 });
ProSchema.index({ profileVisible: 1, state: 1 });
ProSchema.index({ profileVisible: 1, state: 1, lga: 1 });
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
 * SAFE mapper used by /api/barbers and the Browse page.
 *
 * Extra safeguards here because sometimes the Pro doc was created from an application
 * that only had identity.state or identity.city (not top-level state/lga).
 */
export function proToBarber(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;

  // 1) location: try top-level first, then fall back to identity/professional
  const lgaRaw =
    d.lga ||
    d?.identity?.lga ||
    d?.identity?.city || // some payloads used "city" for LGA
    d?.professional?.lga ||
    "";
  const stateRaw =
    d.state || d?.identity?.state || d?.professional?.state || "";

  const lga = lgaRaw ? String(lgaRaw).toUpperCase() : "";
  const state = stateRaw ? String(stateRaw).toUpperCase() : "";

  // 2) pick up services from wherever they were saved
  let rawServices = Array.isArray(d?.services) ? d.services : [];

  // legacy location from older application payloads
  if ((!rawServices || rawServices.length === 0) && d?.professional) {
    if (Array.isArray(d.professional.services)) {
      rawServices = d.professional.services;
    } else if (Array.isArray(d.professional.serviceList)) {
      rawServices = d.professional.serviceList;
    }
  }

  // 2b) normalize services → always { name, price, ... }
  const normalizedServices = Array.isArray(rawServices)
    ? rawServices
        .filter((s) => (typeof s?.visible === "boolean" ? s.visible : true))
        .map((s) => {
          // if it's just "Barbering" → turn into an object
          if (typeof s === "string") {
            return { name: s, price: 0 };
          }

          // accept multiple legacy price fields
          let rawPrice;

          if (s?.price !== undefined && s?.price !== null && s.price !== "") {
            rawPrice = s.price;
          } else if (
            s?.amount !== undefined &&
            s.amount !== null &&
            s.amount !== ""
          ) {
            rawPrice = s.amount;
          } else if (
            s?.priceNaira !== undefined &&
            s.priceNaira !== null &&
            s.priceNaira !== ""
          ) {
            rawPrice = s.priceNaira;
          } else if (
            s?.promoPrice !== undefined &&
            s.promoPrice !== null &&
            s.promoPrice !== ""
          ) {
            rawPrice = s.promoPrice;
          } else {
            rawPrice = 0;
          }

          // strip commas, ₦, spaces
          const cleaned = String(rawPrice).replace(/[₦₦,]/g, "").trim();

          const n = Number(cleaned);
          const priceNum = Number.isFinite(n) ? n : 0;

          return {
            name: s?.name || "",
            price: priceNum,
            description: s?.description || s?.desc || "",
            durationMins: Number.isFinite(
              Number(s?.durationMins || s?.durationMin),
            )
              ? Number(s.durationMins || s.durationMin)
              : 0,
          };
        })
        .filter((s) => s.name)
    : [];

  // 2c) derive a starting price so UI doesn't have to compute
  const startingPrice =
    normalizedServices.length > 0
      ? Math.min(...normalizedServices.map((s) => s.price || 0))
      : 0;

  // 3) rating: show NOTHING unless there is a real review
  const totalReviews = Number(d?.metrics?.totalReviews || 0);
  const hasRealReviews = totalReviews > 0;

  let rating = 0;
  if (hasRealReviews) {
    const metricsAvg = Number(d?.metrics?.avgRating);
    if (Number.isFinite(metricsAvg) && metricsAvg > 0) {
      rating = metricsAvg;
    } else if (Number.isFinite(d?.rating) && d.rating > 0) {
      rating = Number(d.rating);
    }
  }

  rating = Math.max(0, Math.min(5, rating));
  const ratingRounded = Math.round(rating * 10) / 10;

  const fullStars = hasRealReviews ? Math.floor(ratingRounded) : 0;
  const emptyStars = 5 - fullStars;

  return {
    id: d._id?.toString?.() || String(d._id || ""),

    // name: prefer pro.name, but fall back to identity if pro.name is empty
    name:
      d.name ||
      [d?.identity?.firstName, d?.identity?.lastName]
        .filter(Boolean)
        .join(" ") ||
      "",

    // avatar for barber card
    photoUrl: d.photoUrl || d?.identity?.photoUrl || "",

    lga,
    state,
    availability: d.availability || "Available",

    // expose status if present (sometimes useful)
    status: d.status || "approved",

    rating: hasRealReviews ? ratingRounded : 0,
    ratingStars: {
      full: fullStars,
      empty: emptyStars,
    },
    ratingCount: totalReviews,

    services: normalizedServices,
    startingPrice,

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

export const Pro = mongoose.models.Pro || mongoose.model("Pro", ProSchema);

/* -------------------------------------------------------------------------- */
/* SUMMARY
   - state/lga are uppercased on save, AND proToBarber also re-derives them
     from identity/professional if top-level fields were empty.
   - services are pulled from pro.services OR pro.professional.services OR simple strings.
   - prices are now parsed from strings like "15,000" so UI stops seeing 0.
   - startingPrice is derived so cards can show "From ₦..." easily.
   - extra indexes help /api/barbers when Browse.jsx sends ?state=... or ?lga=...
*/
/* -------------------------------------------------------------------------- */
