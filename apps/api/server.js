// apps/api/server.js
// Node ESM server (package.json "type": "module")

import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import admin from "firebase-admin";
import crypto from "crypto";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import cron from "node-cron";

import { Application, Pro, proToBarber } from "./models.js";
import bookingsRouter from "./routes/bookings.js";
import { Booking } from "./models/Booking.js";

// Wallet & Ledger
import { withAuth as walletWithAuth } from "./routes/wallets.js";
import { creditProPendingForBooking } from "./services/walletService.js";

// ✅ PIN routes (set / reset / forgot)
import pinRoutes from "./routes/pin.js";
// ✅ Case-sensitive import (your file is Profile.js)
import profileRouter from "./routes/Profile.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;

/* ------------------- NG GEO (local JSON) ------------------- */
let NG_GEO = null;
const NG_GEO_PATH = path.join(__dirname, "data", "ng-geo.json");
try {
  const raw = fs.readFileSync(NG_GEO_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("Bad ng-geo.json structure");
  NG_GEO = parsed;
  console.log("[geo] ✅ Loaded Nigeria geo data");
} catch (e) {
  console.warn("[geo] ⚠️ Could not load ng-geo.json:", e?.message || e);
  NG_GEO = null;
}

/* ------------------- Admin config ------------------- */
const ADMIN_UIDS = (process.env.ADMIN_UIDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function requireAdmin(req, res, next) {
  if (!req.user?.uid || !ADMIN_UIDS.includes(req.user.uid)) {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

/* ------------------- Firebase Admin ------------------- */
let adminReady = false;
try {
  const keyPath = new URL("./serviceAccountKey.json", import.meta.url);
  const svc = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(svc) });
  adminReady = true;
  console.log("[auth] ✅ Firebase Admin initialized (service account).");
} catch (e) {
  try {
    admin.initializeApp(); // ADC fallback
    adminReady = true;
    console.log("[auth] ✅ Firebase Admin initialized (ADC).");
  } catch (e2) {
    console.error("[auth] ❌ Firebase Admin failed to initialize:", e2?.message || e2);
    process.exit(1);
  }
}

/* ------------------- MongoDB ------------------- */
const MONGODB_URI = process.env.MONGODB_URI || "";
if (!MONGODB_URI) {
  console.error("[mongo] ❌ Missing MONGODB_URI. Exiting.");
  process.exit(1);
}

/** one-time wallet repair */
async function fixWalletCollectionOnce() {
  try {
    const col = mongoose.connection.db.collection("wallets");
    const indexes = await col.indexes().catch(() => []);
    const hasBad = indexes.find((i) => i.name === "userUid_1");
    const hasGood = indexes.find((i) => i.name === "ownerUid_1" && i.unique);

    try {
      const renameRes = await col.updateMany(
        { userUid: { $exists: true } },
        { $rename: { userUid: "ownerUid" } }
      );
      if (renameRes?.modifiedCount) {
        console.log(`[wallets] 🔧 Renamed userUid → ownerUid for ${renameRes.modifiedCount} docs`);
      }
    } catch {}

    if (hasBad) {
      try {
        await col.dropIndex("userUid_1");
        console.log("[wallets] 🔧 Dropped stale index userUid_1");
      } catch (e) {
        console.warn("[wallets] dropIndex warn:", e?.message || e);
      }
    }

    if (!hasGood) {
      try {
        await col.createIndex({ ownerUid: 1 }, { unique: true, name: "ownerUid_1" });
        console.log("[wallets] ✅ Ensured unique index ownerUid_1");
      } catch (e) {
        console.warn("[wallets] createIndex warn:", e?.message || e);
      }
    }

    try {
      const del = await col.deleteMany({
        $or: [{ ownerUid: null }, { ownerUid: "" }, { ownerUid: { $exists: false } }],
      });
      if (del?.deletedCount) {
        console.log(`[wallets] 🧹 Removed ${del.deletedCount} invalid wallet docs`);
      }
    } catch {}
  } catch (err) {
    console.warn("[wallets] repair skipped:", err?.message || err);
  }
}

/* ------------------- Settings (singleton) ------------------- */
const CommissionSplitSchema = new mongoose.Schema(
  { platform: { type: Number, default: 25 }, pro: { type: Number, default: 75 } },
  { _id: false }
);
const PayoutsSchema = new mongoose.Schema(
  {
    releaseDays: { type: Number, default: 7 },
    instantCashoutFeePercent: { type: Number, default: 3 },
    enableAutoRelease: { type: Boolean, default: true },
    autoReleaseCron: { type: String, default: "0 2 * * *" },
  },
  { _id: false }
);
const BookingRulesSchema = new mongoose.Schema(
  {
    noShowStrikeLimit: { type: Number, default: 2 },
    enableNoShowSweep: { type: Boolean, default: true },
    noShowSweepCron: { type: String, default: "0 3 * * *" },
  },
  { _id: false }
);
const MaintenanceSchema = new mongoose.Schema(
  {
    isMaintenanceMode: { type: Boolean, default: false },
    message: { type: String, default: "We’ll be back shortly." },
  },
  { _id: false }
);
const NotificationsSchema = new mongoose.Schema(
  { emailEnabled: { type: Boolean, default: false }, smsEnabled: { type: Boolean, default: false } },
  { _id: false }
);

const SettingsSchema = new mongoose.Schema(
  {
    appName: { type: String, default: "Kpocha Touch Unisex Salon" },
    tagline: { type: String, default: "Connecting You To Top Barbers and Stylists" },
    commissionSplit: { type: CommissionSplitSchema, default: () => ({}) },
    payouts: { type: PayoutsSchema, default: () => ({}) },
    bookingRules: { type: BookingRulesSchema, default: () => ({}) },
    maintenance: { type: MaintenanceSchema, default: () => ({}) },
    notifications: { type: NotificationsSchema, default: () => ({}) },
    withdrawals: { type: new mongoose.Schema({ requireApproval: { type: Boolean, default: true } }, { _id: false }) },
    security: { allowedOrigins: { type: [String], default: [] } },
    webhooks: { paystack: { secret: { type: String, default: "" } } },
    updatedBy: { type: String, default: "system" },
  },
  { timestamps: true }
);
const Settings = mongoose.models.Settings || mongoose.model("Settings", SettingsSchema);

let SETTINGS_CACHE = null;
async function loadSettings({ force = false } = {}) {
  if (SETTINGS_CACHE && !force) return SETTINGS_CACHE;
  let doc = await Settings.findOne();
  if (!doc) doc = await Settings.create({});
  SETTINGS_CACHE = doc;
  return SETTINGS_CACHE;
}
function getCachedSettings() {
  return SETTINGS_CACHE;
}
async function updateSettings(updates = {}, updatedBy = "admin") {
  const doc = await loadSettings();
  Object.assign(doc, updates, { updatedBy });
  await doc.save();
  SETTINGS_CACHE = doc;
  return SETTINGS_CACHE;
}

/* ------------------- Connect Mongo & warm cache ------------------- */
try {
  await mongoose.connect(MONGODB_URI);
  console.log("[mongo] ✅ Connected:", mongoose.connection?.db?.databaseName);
  await fixWalletCollectionOnce();
  await loadSettings({ force: true });
} catch (err) {
  console.error("[mongo] ❌ Connection error:", err?.message || err);
}

/* ------------------- Schedulers ------------------- */
let CRON_TASKS = [];
async function initSchedulers() {
  CRON_TASKS.forEach((t) => t.stop());
  CRON_TASKS = [];

  const s = await loadSettings();

  if (s?.payouts?.enableAutoRelease && s?.payouts?.autoReleaseCron) {
    const t = cron.schedule(s.payouts.autoReleaseCron, async () => {
      try {
        const releaseDays = s.payouts.releaseDays ?? 7;
        const cutoff = new Date(Date.now() - releaseDays * 24 * 60 * 60 * 1000);
        const toRelease = await Booking.find({
          status: "completed",
          payoutReleased: { $ne: true },
          completedAt: { $lte: cutoff },
        })
          .select("_id proId amountKobo completedAt payoutReleased")
          .limit(500);

        for (const b of toRelease) {
          await Booking.updateOne({ _id: b._id }, { $set: { payoutReleased: true } });
        }
        console.log(`[scheduler] Auto-release ran. Marked: ${toRelease.length}`);
      } catch (err) {
        console.error("[scheduler] Auto-release error:", err.message);
      }
    });
    CRON_TASKS.push(t);
  }

  if (s?.bookingRules?.enableNoShowSweep && s?.bookingRules?.noShowSweepCron) {
    const t = cron.schedule(s.bookingRules.noShowSweepCron, async () => {
      try {
        const strikeLimit = s.bookingRules.noShowStrikeLimit ?? 2;
        console.log(`[scheduler] No-show sweep ran. Strike limit: ${strikeLimit}`);
      } catch (err) {
        console.error("[scheduler] No-show sweep error:", err.message);
      }
    });
    CRON_TASKS.push(t);
  }

  CRON_TASKS.forEach((t) => t.start());
  console.log("[scheduler] Schedulers initialized.");
}
async function restartSchedulers() {
  await initSchedulers();
}

/* ------------------- Express App ------------------- */
const app = express();

// CORS
function computeAllowedOrigins() {
  const envOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const settingsOrigins = (getCachedSettings()?.security?.allowedOrigins || []).map((s) => s.trim());
  return Array.from(new Set([...envOrigins, ...settingsOrigins]));
}
app.use(morgan("dev"));
app.use(
  cors({
    origin: (origin, cb) => {
      const allowlist = computeAllowedOrigins();
      if (!origin || allowlist.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked"));
    },
  })
);

// Webhook must parse raw body
app.post(
  "/api/paystack/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const secret = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_WEBHOOK_SECRET || "";
      const signature = req.headers["x-paystack-signature"];
      const computed = crypto.createHmac("sha512", secret).update(req.body).digest("hex");
      if (!signature || signature !== computed) return res.status(401).send("Invalid signature");

      const event = JSON.parse(req.body.toString());
      handlePaystackEvent(event).catch((err) => console.error("[paystack] handler error:", err));
      res.sendStatus(200);
    } catch (err) {
      console.error("[paystack] webhook processing error:", err);
      res.sendStatus(400);
    }
  }
);

// JSON afterwards
app.use(express.json());

/* ------------------- Auth Middleware ------------------- */
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email || null };
    next();
  } catch (err) {
    return res.status(401).json({
      error: "Invalid or expired token",
      details: err?.code || err?.name,
    });
  }
}

/** ✅ Pro-only guard (used for payout/withdraw routes) */
async function requirePro(req, res, next) {
  try {
    const pro = await Pro.findOne({ ownerUid: req.user.uid }).select("_id").lean();
    if (!pro) return res.status(403).json({ error: "pro_only" });
    req.proId = pro._id.toString();
    next();
  } catch (e) {
    res.status(500).json({ error: "check_pro_failed" });
  }
}

/* ------------------- Maintenance Mode Gate ------------------- */
function maintenanceBypass(req) {
  if (req.path === "/api/health") return true;
  if (req.path.startsWith("/api/paystack/webhook")) return true;
  if (req.path.startsWith("/api/settings/admin")) return true;
  return false;
}
app.use(async (req, res, next) => {
  try {
    const s = getCachedSettings() || (await loadSettings());
    if (!s?.maintenance?.isMaintenanceMode) return next();

    try {
      const h = req.headers.authorization || "";
      const token = h.startsWith("Bearer ") ? h.slice(7) : null;
      if (token) {
        const decoded = await admin.auth().verifyIdToken(token);
        if (decoded?.uid && ADMIN_UIDS.includes(decoded.uid)) return next();
      }
    } catch {}

    if (maintenanceBypass(req)) return next();
    return res.status(503).json({
      error: "maintenance",
      message: s.maintenance.message || "We’ll be back shortly.",
    });
  } catch {
    return next();
  }
});

/* ------------------- Verified client identity helpers ------------------- */
/**
 * We fetch a client's verified identity from the "profiles" collection (generic),
 * falling back to any likely fields. This avoids tight coupling to Profile.js internals.
 */
async function getVerifiedClientIdentity(uid) {
  try {
    const col = mongoose.connection.db.collection("profiles");
    const p = await col.findOne(
      { uid },
      { projection: { fullName: 1, name: 1, displayName: 1, phone: 1, identity: 1 } }
    );
    if (!p) return { fullName: "", phone: "" };

    const fullName =
      p.fullName ||
      p.name ||
      p.displayName ||
      [p?.identity?.firstName, p?.identity?.middleName, p?.identity?.lastName].filter(Boolean).join(" ").trim() ||
      "";

    const phone = p.phone || p?.identity?.phone || "";

    return { fullName, phone };
  } catch {
    return { fullName: "", phone: "" };
  }
}

/** Public endpoint for the web app to show read-only identity on Book page */
app.get("/api/profile/client/me", requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });
    const { fullName, phone } = await getVerifiedClientIdentity(req.user.uid);
    res.json({ uid: req.user.uid, email: req.user.email, fullName, phone });
  } catch (e) {
    res.status(500).json({ error: "failed" });
  }
});

/**
 * 🔒 Server-side enforcement:
 * For any POST under /api/bookings, we overwrite any client-sent name/phone
 * with the verified values fetched above. This protects professionals even if
 * the UI is tampered with.
 */
app.use("/api/bookings", requireAuth, async (req, _res, next) => {
  try {
    if (req.method !== "POST") return next();
    if (mongoose.connection.readyState !== 1) return next();

    const { fullName, phone } = await getVerifiedClientIdentity(req.user.uid);
    // Attach to body in common shapes used by booking creation flows:
    req.body = req.body || {};
    // legacy flat fields
    req.body.clientName = fullName || req.body.clientName || "";
    req.body.clientPhone = phone || req.body.clientPhone || "";
    // nested shape
    req.body.client = {
      ...(req.body.client || {}),
      name: fullName || req.body?.client?.name || "",
      phone: phone || req.body?.client?.phone || "",
    };
    // also stamp uid for safety
    req.body.clientUid = req.user.uid;

    next();
  } catch {
    next();
  }
});

/* ------------------- Routers ------------------- */

/** 🔒 Pro payout write-ops guard */
app.use("/api/wallet", requireAuth, (req, res, next) => {
  const write =
    req.method === "POST" || req.method === "PUT" || req.method === "DELETE" || req.method === "PATCH";
  if (!write) return next();
  return requirePro(req, res, next);
});

/** ✅ Optional client wallet credits endpoint (read-only). */
app.get("/api/wallet/client/me", requireAuth, async (_req, res) => {
  res.json({ creditsKobo: 0, transactions: [] });
});

app.use("/api", bookingsRouter);
app.use("/api", walletWithAuth(requireAuth, requireAdmin));
app.use("/api", pinRoutes({ requireAuth, Application })); // /pin/me/*
app.use("/api", profileRouter);

/* ----- Optional availability router (mounted if file exists) ----- */
try {
  const { default: availabilityRouter } = await import("./routes/availability.js").catch(() => ({ default: null }));
  if (availabilityRouter) {
    app.use("/api", availabilityRouter);
    console.log("[api] ✅ Availability routes mounted");
  } else {
    console.log("[api] ℹ️ Availability routes not present (skipped)");
  }
} catch {}

/* ------------------- Deactivation Requests ------------------- */
const DeactivationRequestSchema = new mongoose.Schema(
  {
    uid: { type: String, index: true, required: true },
    email: { type: String, default: "" },
    reason: { type: String, default: "" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    note: { type: String, default: "" },
    decidedBy: { type: String, default: "" },
    decidedAt: { type: Date },
  },
  { timestamps: true }
);
const DeactivationRequest =
  mongoose.models.DeactivationRequest ||
  mongoose.model("DeactivationRequest", DeactivationRequestSchema);

app.post("/api/account/deactivate-request", requireAuth, async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").slice(0, 1000);
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });

    let existing = await DeactivationRequest.findOne({ uid: req.user.uid, status: "pending" }).lean();
    if (existing) return res.json({ ok: true, request: existing });

    const doc = await DeactivationRequest.create({
      uid: req.user.uid,
      email: req.user.email || "",
      reason,
      status: "pending",
    });
    return res.json({ ok: true, request: doc });
  } catch (err) {
    console.error("[deactivate-request] error:", err);
    res.status(500).json({ error: "failed" });
  }
});

app.get("/api/account/deactivation/me", requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });
    const doc = await DeactivationRequest.findOne({ uid: req.user.uid }).sort({ createdAt: -1 }).lean();
    return res.json(doc || null);
  } catch (err) {
    console.error("[deactivation:me] error:", err);
    res.status(500).json({ error: "failed" });
  }
});

app.get("/api/admin/deactivation-requests", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const docs = await DeactivationRequest.find({}).sort({ createdAt: -1 }).limit(500).lean();
    res.json(docs);
  } catch (err) {
    console.error("[admin:deactivation list] error:", err);
    res.status(500).json({ error: "failed" });
  }
});

app.post("/api/admin/deactivation-requests/:id/decision", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, note = "" } = req.body || {};
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return res.status(400).json({ error: "invalid_id" });
    if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "invalid_action" });

    const doc = await DeactivationRequest.findById(id);
    if (!doc) return res.status(404).json({ error: "not_found" });
    if (doc.status !== "pending") return res.status(400).json({ error: "already_decided" });

    if (action === "approve") {
      try { await admin.auth().updateUser(doc.uid, { disabled: true }); } catch (e) { console.warn("[admin] disable warn:", e?.message || e); }
      doc.status = "approved";
    } else {
      doc.status = "rejected";
    }

    doc.note = String(note || "").slice(0, 2000);
    doc.decidedBy = req.user?.email || req.user?.uid || "admin";
    doc.decidedAt = new Date();
    await doc.save();

    res.json({ ok: true, request: doc });
  } catch (err) {
    console.error("[admin:deactivation decide] error:", err);
    res.status(500).json({ error: "failed" });
  }
});

/* ------------------- Who am I ------------------- */
app.get("/api/me", requireAuth, async (req, res) => {
  try {
    let pro = null;
    let appDoc = null;
    let latestDeact = null;

    if (mongoose.connection.readyState === 1) {
      pro = await Pro.findOne({ ownerUid: req.user.uid }).lean();
      appDoc = await Application.findOne({ uid: req.user.uid }).lean();
      latestDeact = await DeactivationRequest.findOne({ uid: req.user.uid })
        .sort({ createdAt: -1 })
        .select("status createdAt")
        .lean();
    }

    res.json({
      uid: req.user.uid,
      email: req.user.email,
      isPro: !!pro,
      proId: pro?._id?.toString() || null,
      proName: pro?.name || null,
      lga: pro?.lga || null,
      isAdmin: ADMIN_UIDS.includes(req.user.uid),
      hasPin: !!appDoc?.withdrawPinHash,
      deactivationPending: latestDeact?.status === "pending",
      deactivationStatus: latestDeact?.status || null,
    });
  } catch (err) {
    console.error("[me] error:", err);
    res.status(500).json({ error: "failed" });
  }
});

/* ------------------- Dev reset ------------------- */
app.delete("/api/dev/reset", async (_req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      await Application.deleteMany({});
      await Pro.deleteMany({});
      await Booking.deleteMany({});
      await DeactivationRequest.deleteMany({});
      console.log("[reset] ✅ MongoDB collections cleared.");
    }
    res.json({ ok: true, message: "All applications, pros, bookings, deactivation requests deleted." });
  } catch (err) {
    console.error("[reset] ❌ Reset error:", err);
    res.status(500).json({ error: "Failed to reset database" });
  }
});

/* ------------------- Health ------------------- */
app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ------------------- Barbers ------------------- */
app.get("/api/barbers", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });
    const { lga } = req.query;
    const q = {};
    if (lga) q.lga = lga.toUpperCase();
    const docs = await Pro.find(q).lean();
    return res.json(docs.map(proToBarber));
  } catch (err) {
    console.error("[barbers] DB error:", err);
    res.status(500).json({ error: "Failed to load barbers" });
  }
});

app.get("/api/barbers/:id", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });
    const doc = await Pro.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: "Not found" });
    return res.json(proToBarber(doc));
  } catch (err) {
    console.error("[barbers:id] DB error:", err);
    res.status(500).json({ error: "Failed to load barber" });
  }
});

/* ------------------- Barbers Nearby ------------------- */
const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY || "9258e71a50234a35b0bec3b44515b023";

async function reverseGeocode(lat, lon) {
  if (!GEOAPIFY_KEY) return null;
  const r = await fetch(
    `https://api.geoapify.com/v1/geocode/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&apiKey=${encodeURIComponent(GEOAPIFY_KEY)}`
  );
  if (!r.ok) return null;
  const j = await r.json();
  const p = j?.features?.[0]?.properties || {};
  const state = (p.state || p.region || "").toString().toUpperCase();
  const lga = (p.county || p.city || p.district || p.suburb || "").toString().toUpperCase();
  return { state, lga };
}

app.get("/api/barbers/nearby", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });

    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radiusKm = Math.max(1, Math.min(200, Number(req.query.radiusKm || 25)));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: "lat & lon required" });

    let used = "geo", items = [];
    try {
      const agg = await Pro.aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [lon, lat] },
            distanceField: "dist",
            spherical: true,
            maxDistance: radiusKm * 1000,
            key: "loc"
          }
        },
        { $limit: 100 }
      ]);
      items = agg.map((d) => {
        const shaped = proToBarber(d);
        return { ...shaped, distanceKm: Math.round((d.dist / 1000) * 10) / 10 };
      });
    } catch {
      used = "lga";
      const rev = await reverseGeocode(lat, lon);
      const lga = rev?.lga || "";
      const state = rev?.state || "";
      let q = {};
      if (lga) q = { lga };
      else if (state) q = { lga: new RegExp(`^${state}\\b`, "i") };
      const docs = await Pro.find(q).limit(100).lean();
      items = docs.map((d) => ({ ...proToBarber(d), distanceKm: null }));
    }

    return res.json({ mode: used, radiusKm, count: items.length, items });
  } catch (err) {
    console.error("[barbers/nearby] error:", err);
    res.status(500).json({ error: "nearby_failed" });
  }
});

/* ------------------- Nigeria Geo (static) ------------------- */
app.get("/api/geo/ng", (_req, res) => {
  try {
    if (!NG_GEO) return res.status(500).json({ error: "geo_load_failed" });
    res.json({ states: Object.keys(NG_GEO), lgas: NG_GEO });
  } catch (e) {
    console.error("[geo/ng] error:", e);
    res.status(500).json({ error: "geo_load_failed" });
  }
});
app.get("/api/geo/ng/states", (_req, res) => {
  try {
    if (!NG_GEO) return res.status(500).json({ error: "geo_load_failed" });
    res.json(Object.keys(NG_GEO));
  } catch (e) {
    console.error("[geo/ng/states] error:", e);
    res.status(500).json({ error: "geo_states_failed" });
  }
});
app.get("/api/geo/ng/lgas/:state", (req, res) => {
  try {
    if (!NG_GEO) return res.status(500).json({ error: "geo_load_failed" });
    const st = decodeURIComponent(req.params.state || "").trim();
    const lgas = NG_GEO[st];
    if (!lgas) return res.status(404).json({ error: "state_not_found" });
    res.json(lgas);
  } catch (e) {
    console.error("[geo/ng/lgas/:state] error:", e);
    res.status(500).json({ error: "geo_lgas_failed" });
  }
});

/* ------------------- Geoapify Proxy ------------------- */
app.get("/api/geo/rev", async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "lat & lon required" });

    const nLat = Number(lat), nLon = Number(lon);
    if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return res.status(400).json({ error: "lat & lon must be numbers" });
    if (!GEOAPIFY_KEY) return res.status(500).json({ error: "geo_key_missing" });

    const r = await fetch(
      `https://api.geoapify.com/v1/geocode/reverse?lat=${encodeURIComponent(nLat)}&lon=${encodeURIComponent(nLon)}&apiKey=${encodeURIComponent(GEOAPIFY_KEY)}`
    );
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error("[geo/rev] error:", e?.message || e);
    res.status(500).json({ error: "reverse_failed" });
  }
});
app.get("/api/geo/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q required" });
    if (!GEOAPIFY_KEY) return res.status(500).json({ error: "geo_key_missing" });

    const r = await fetch(
      `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(q)}&limit=5&apiKey=${encodeURIComponent(GEOAPIFY_KEY)}`
    );
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error("[geo/search] error:", e?.message || e);
    res.status(500).json({ error: "search_failed" });
  }
});

/* ------------------- Payments (Paystack) ------------------- */
/** ✅ Init (for redirect fallback) */
app.post("/api/payments/init", requireAuth, async (req, res) => {
  try {
    const { bookingId, amountKobo, email } = req.body || {};
    if (!bookingId || !amountKobo) return res.status(400).json({ error: "bookingId and amountKobo required" });
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(500).json({ error: "paystack_secret_missing" });

    // Make sure booking exists & stamp pending state
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: "booking_not_found" });

    // Initialize with Paystack
    const initResp = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: email || req.user.email || "customer@example.com",
        amount: Number(amountKobo), // kobo
        reference: `BOOKING-${booking._id}`,
        metadata: {
          custom_fields: [{ display_name: "Booking", variable_name: "bookingId", value: String(booking._id) }],
        },
      }),
    });

    const initJson = await initResp.json();
    if (!initResp.ok || !initJson?.status || !initJson?.data?.authorization_url) {
      return res.status(400).json({ error: "init_failed", details: initJson?.message || "unknown_error" });
    }

    // Persist reference and mark pending payment
    booking.paystackReference = initJson.data.reference || `BOOKING-${booking._id}`;
    if (booking.paymentStatus !== "paid") {
      booking.paymentStatus = "pending";
      booking.status = booking.status === "scheduled" ? booking.status : "pending_payment";
    }
    await booking.save();

    return res.json({
      authorization_url: initJson.data.authorization_url,
      reference: initJson.data.reference,
    });
  } catch (e) {
    console.error("[payments/init] error:", e);
    res.status(500).json({ error: "init_error" });
  }
});

/** ✅ Verify (used by inline & post-redirect confirmation) */
app.post("/api/payments/verify", async (req, res) => {
  try {
    const { bookingId, reference } = req.body || {};
    if (!bookingId || !reference) return res.status(400).json({ error: "bookingId and reference required" });

    const r = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    const verify = await r.json();

    const status = verify?.data?.status;
    const amount = verify?.data?.amount;
    if (status !== "success") return res.json({ ok: false, status: status || "unknown" });

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    if (booking.amountKobo && Number(amount) !== Number(booking.amountKobo)) {
      console.warn("[paystack] amount mismatch", amount, "vs", booking.amountKobo);
    }

    booking.paymentStatus = "paid";
    if (booking.status === "pending_payment") booking.status = "scheduled";
    booking.paystackReference = reference;
    await booking.save();

    try {
      await creditProPendingForBooking(booking, { paystackRef: reference });
    } catch (err) {
      console.error("[wallet] credit pending error:", err);
    }

    return res.json({ ok: true, status: "success" });
  } catch (e) {
    console.error("[payments/verify] error:", e);
    res.status(500).json({ error: "verify_failed" });
  }
});

/* ------------------- Pros (new forms) ------------------- */
/** 🔧 GET /api/pros/me returns application or a read-only stub for approved pros */
app.get("/api/pros/me", requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database not connected" });
    }

    const appDoc = await Application.findOne({ uid: req.user.uid }).lean();
    if (appDoc) return res.json(appDoc);

    const pro = await Pro.findOne({ ownerUid: req.user.uid }).lean();
    if (pro) {
      return res.json({
        _id: pro._id,
        uid: req.user.uid,
        email: req.user.email,
        displayName: pro.name || req.user.email,
        lga: (pro.lga || "").toUpperCase(),
        professional: { services: pro.services || [] },
        availability: { statesCovered: [] },
        status: "approved",
        readOnly: true,
      });
    }

    return res.json(null);
  } catch (err) {
    console.error("[pros/me GET] error:", err);
    res.status(500).json({ error: "failed" });
  }
});

app.put("/api/pros/me", requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });

    // 🔒 explicit guard: do not allow creation here
    const existing = await Application.findOne({ uid: req.user.uid }).lean();
    if (!existing) {
      return res.status(403).json({ error: "No professional profile exists. Please apply first." });
    }

    const body = req.body || {};
    const identity = body.identity || {};
    const professional = body.professional || {};

    const displayName =
      body.displayName ||
      [identity.firstName, identity.middleName, identity.lastName].filter(Boolean).join(" ").trim() ||
      req.user.email;

    const phone = identity.phone || body.phone || null;
    const lgaRaw = body.lga || identity.city || identity.state || "";
    const lga = (lgaRaw || "").toString().toUpperCase();

    const servicesSummary = Array.isArray(professional.services)
      ? professional.services.join(", ")
      : body.services || "";

    const toSet = {
      ...body,
      uid: req.user.uid,
      email: req.user.email,
      displayName,
      phone,
      lga,
      services: servicesSummary,
      status: body.status || "submitted",
    };

    if (body.phoneVerifiedAt) toSet.phoneVerifiedAt = new Date(body.phoneVerifiedAt);
    if (body.verification?.phoneVerifiedAt) {
      toSet.verification = { ...(toSet.verification || {}), phoneVerifiedAt: new Date(body.verification.phoneVerifiedAt) };
    }

    if (body.bank && !body.payoutBank) {
      const b = body.bank || {};
      toSet.payoutBank = {
        name: b.bankName || b.name || "",
        code: b.bankCode || b.code || "",
        accountNumber: b.accountNumber || b.account_no || "",
        accountName: b.accountName || b.account_name || "",
      };
    }

    const saved = await Application.findOneAndUpdate(
      { uid: req.user.uid },
      { $set: toSet },
      { new: true, upsert: false } // ⛔️ no upsert; settings must not create
    ).lean();

    return res.json({ ok: true, item: saved });
  } catch (err) {
    console.error("[pros/me PUT] error:", err);
    res.status(500).json({ error: "failed_to_save" });
  }
});

/* ------------------- Legacy dev helpers (kept) ------------------- */
app.post("/api/pros/apply", requireAuth, async (req, res) => {
  const { displayName, phone, lga, services = "" } = req.body || {};
  if (!displayName || !phone || !lga) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    if (mongoose.connection.readyState === 1) {
      const clientId = Date.now().toString();
      const appDoc = await Application.create({
        uid: req.user.uid,
        email: req.user.email,
        displayName,
        phone,
        lga,
        services,
        clientId,
      });
      return res.json({ ok: true, item: appDoc });
    } else {
      return res.status(503).json({ error: "Database not connected" });
    }
  } catch (err) {
    console.error("[pros/apply] error:", err);
    return res.status(500).json({ error: "Failed to save application" });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.get("/api/pros/pending", async (_req, res) => {
    try {
      if (mongoose.connection.readyState === 1) {
        const docs = await Application.find({}).sort({ createdAt: -1 }).lean();
        return res.json(docs);
      }
      return res.status(503).json({ error: "Database not connected" });
    } catch (err) {
      console.error("[pros/pending] error:", err);
      res.status(500).json({ error: "Failed to load pending applications" });
    }
  });

  app.post("/api/pros/approve/:id", async (req, res) => {
    try {
      const rawId = req.params.id;
      if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });

      let doc =
        (await Application.findOneAndUpdate(
          { clientId: rawId },
          { status: "approved" },
          { new: true }
        )) ||
        (/^[0-9a-fA-F]{24}$/.test(rawId)
          ? await Application.findOneAndUpdate({ _id: rawId }, { status: "approved" }, { new: true })
          : null);

      if (!doc) return res.status(404).json({ error: "Not found" });

      const name =
        doc.displayName ||
        [doc?.identity?.firstName, doc?.identity?.lastName].filter(Boolean).join(" ") ||
        doc.email;

      const lga =
        (doc.lga || doc?.identity?.city || doc?.identity?.state || "UNSPECIFIED").toString().toUpperCase();

      const services =
        (Array.isArray(doc?.professional?.services) && doc.professional.services) || [];

      const pro = await Pro.create({
        ownerUid: doc.uid,
        name,
        lga,
        availability: "Available",
        rating: 4.8,
        services,
      });

      await Application.deleteOne({ _id: doc._id });
      return res.json({ ok: true, proId: pro._id.toString() });
    } catch (err) {
      console.error("[pros/approve] error:", err);
      res.status(500).json({ error: "Failed to approve" });
    }
  });
}

/* ------------------- Decline ------------------- */
app.post("/api/pros/decline/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });
    const { reason = "" } = req.body || {};
    const rawId = req.params.id;

    let doc =
      (await Application.findOneAndUpdate(
        { clientId: rawId },
        { status: "declined", declineReason: reason, declinedAt: new Date() },
        { new: true }
      )) ||
      (/^[0-9a-fA-F]{24}$/.test(rawId)
        ? await Application.findOneAndUpdate(
            { _id: rawId },
            { status: "declined", declineReason: reason, declinedAt: new Date() },
            { new: true }
          )
        : null);

    if (!doc) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[pros/decline] error:", err);
    res.status(500).json({ error: "Failed to decline" });
  }
});

/* ------------------- Settings routes ------------------- */
app.get("/api/settings", async (_req, res) => {
  try {
    const s = await loadSettings();
    res.json({
      appName: s.appName,
      tagline: s.tagline,
      commissionSplit: s.commissionSplit,
      payouts: s.payouts,
      withdrawals: s.withdrawals,
      bookingRules: s.bookingRules,
      maintenance: s.maintenance,
      notifications: s.notifications,
      security: s.security,
      updatedAt: s.updatedAt,
      updatedBy: s.updatedBy,
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to load settings", details: e.message });
  }
});

app.get("/api/settings/admin", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const s = await loadSettings();
    res.json(s);
  } catch (e) {
    res.status(500).json({ error: "Failed to load settings", details: e.message });
  }
});

app.put("/api/settings", requireAuth, requireAdmin, async (req, res) => {
  try {
    const updated = await updateSettings(req.body, req.user?.email || "admin");
    await restartSchedulers();
    const clean = updated.toObject();
    if (clean?.webhooks?.paystack) delete clean.webhooks.paystack.secret;
    res.json(clean);
  } catch (e) {
    res.status(500).json({ error: "Failed to update settings", details: e.message });
  }
});

app.post("/api/admin/release-booking/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) return res.status(400).json({ error: "invalid_id" });

    const s = await loadSettings();
    const proPct = Number(s?.commissionSplit?.pro ?? 75);

    const b = await Booking.findById(id);
    if (!b) return res.status(404).json({ error: "booking_not_found" });
    if (b.payoutReleased) return res.json({ ok: true, alreadyReleased: true });

    const releasedKobo = Math.round(Number(b.amountKobo || 0) * (proPct / 100));
    b.payoutReleased = true;
    await b.save();

    return res.json({ ok: true, releasedKobo, proPct });
  } catch (e) {
    console.error("[admin:release-booking] error:", e);
    res.status(500).json({ error: "release_failed" });
  }
});

/* ------------------- Feed / Posts (NEW) ------------------- */
const PostSchema = new mongoose.Schema(
  {
    ownerUid: { type: String, index: true },
    proId: { type: mongoose.Schema.Types.ObjectId, ref: "Pro", index: true },
    text: { type: String, default: "" },
    media: [{ url: String, type: { type: String, default: "image" } }],
    tags: { type: [String], default: [] },
    isPublic: { type: Boolean, default: true },
    lga: { type: String, default: "" },
  },
  { timestamps: true }
);
const Post = mongoose.models.Post || mongoose.model("Post", PostSchema);

app.get("/api/feed/public", async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);
    const posts = await Post.find({ isPublic: true }).sort({ createdAt: -1 }).limit(20).lean();
    res.json(posts);
  } catch (e) {
    console.error("[feed/public] error:", e?.message || e);
    res.json([]);
  }
});

/* ------------------- WebRTC: serve ICE servers from env (optional) ------------------- */
app.get("/api/webrtc/ice", (_req, res) => {
  try {
    const stun = (process.env.ICE_STUN_URLS || process.env.VITE_STUN_URLS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const turn = (process.env.ICE_TURN_URLS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const username = process.env.ICE_TURN_USERNAME || process.env.VITE_TURN_USERNAME || "";
    const credential = process.env.ICE_TURN_PASSWORD || process.env.VITE_TURN_PASSWORD || "";

    const iceServers = [];
    if (stun.length) iceServers.push({ urls: stun });
    if (turn.length) iceServers.push({ urls: turn, username, credential });
    if (!iceServers.length) iceServers.push({ urls: ["stun:stun.l.google.com:19302"] });

    res.json({ iceServers });
  } catch (e) {
    res.status(500).json({ error: "ice_build_failed" });
  }
});

/* ------------------- Paystack event handler ------------------- */
async function handlePaystackEvent(event) {
  console.log("[paystack] handling event:", event.event);

  if (event.event === "charge.success") {
    const ref = event?.data?.reference;
    const amount = event?.data?.amount;
    if (!ref) return console.warn("[paystack] charge.success without reference");

    try {
      const booking = await Booking.findOne({ paystackReference: ref });
      if (!booking) return console.warn("[paystack] no booking for ref:", ref);

      if (amount && booking.amountKobo && Number(amount) !== Number(booking.amountKobo)) {
        console.warn("[paystack] amount mismatch for", ref, amount, "vs", booking.amountKobo);
      }

      booking.paymentStatus = "paid";
      if (booking.status === "pending_payment") booking.status = "scheduled";
      await booking.save();

      try {
        await creditProPendingForBooking(booking, { paystackRef: ref });
      } catch (err) {
        console.error("[wallet] credit pending error:", err);
      }

      console.log("[paystack] ✅ booking funded:", booking._id.toString());
    } catch (err) {
      console.error("[paystack] update booking error:", err);
    }
  }
}

/* ------------------- Start (Socket.IO if available) ------------------- */
await initSchedulers();

try {
  const { default: attachSockets } = await import("./sockets/index.js");
  const server = http.createServer(app);
  attachSockets(server);
  server.listen(PORT, () => {
    console.log(`🚀 API listening on ${PORT} (with sockets)`);
  });
} catch (e) {
  console.warn("[sockets] ℹ️ Socket server not attached:", e?.message || e);
  app.listen(PORT, () => {
    console.log(`🚀 API listening on ${PORT}`);
  });
}
