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
import { v2 as cloudinary } from "cloudinary";

import { Application, Pro, proToBarber } from "./models.js";
import bookingsRouter from "./routes/bookings.js";
import { Booking } from "./models/Booking.js";

// Wallet & Ledger
import { withAuth as walletWithAuth } from "./routes/wallets.js";
import {
  creditProPendingForBooking,
  releasePendingToAvailableForBooking,
} from "./services/walletService.js";

// ✅ PIN routes (set / reset / forgot)
import pinRoutes from "./routes/pin.js";
// ✅ Case-sensitive import (your file is Profile.js)
import profileRouter from "./routes/Profile.js";
// ✅ New routes
import postsRouter from "./routes/posts.js";
import paymentsRouter from "./routes/payments.js";

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

function isAdmin(uid) {
  return !!uid && ADMIN_UIDS.includes(uid);
}
function requireAdmin(req, res, next) {
  if (!req.user?.uid || !isAdmin(req.user.uid)) {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

/* ------------------- Firebase Admin ------------------- */
try {
  const keyPath =
    process.env.SERVICE_KEY_PATH || new URL("./serviceAccountKey.json", import.meta.url).pathname;

  const svc = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(svc) });
  console.log("[auth] ✅ Firebase Admin initialized (service account).");
} catch (e) {
  try {
    admin.initializeApp(); // ADC fallback
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
    withdrawals: {
      type: new mongoose.Schema({ requireApproval: { type: Boolean, default: true } }, { _id: false }),
    },
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

  // 🔁 Auto-release completed bookings older than releaseDays
  if (s?.payouts?.enableAutoRelease && s?.payouts?.autoReleaseCron) {
    const t = cron.schedule(s.payouts.autoReleaseCron, async () => {
      const started = Date.now();
      try {
        const releaseDays = s.payouts.releaseDays ?? 7;
        const cutoff = new Date(Date.now() - releaseDays * 24 * 60 * 60 * 1000);

        const toRelease = await Booking.find({
          status: "completed",
          paymentStatus: "paid",
          payoutReleased: { $ne: true },
          completedAt: { $lte: cutoff },
        })
          .select("_id proId amountKobo completedAt payoutReleased")
          .limit(500)
          .lean();

        let ok = 0, fail = 0;
        for (const b of toRelease) {
          try {
            const res = await releasePendingToAvailableForBooking(b, { reason: "auto_release_cron" });
            if (res?.ok) ok++; else fail++;
          } catch (e) {
            fail++;
            console.error("[scheduler] release error for booking", b._id?.toString?.(), e?.message || e);
          }
        }

        console.log(
          `[scheduler] Auto-release ran in ${Math.round((Date.now() - started) / 1000)}s. Processed=${toRelease.length}, ok=${ok}, fail=${fail}`
        );
      } catch (err) {
        console.error("[scheduler] Auto-release error:", err.message);
      }
    });
    CRON_TASKS.push(t);
  }

  // (Placeholder) No-show sweeper
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

//* ------------------- CORS (hardened, with Vercel & ngrok previews) ------------------- */
const ALLOW_LIST = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOW_VERCEL_PREVIEWS = (process.env.ALLOW_VERCEL_PREVIEWS || "true").toLowerCase() !== "false";
const ALLOW_NGROK_PREVIEWS  = (process.env.ALLOW_NGROK_PREVIEWS  || "true").toLowerCase() !== "false";

function hostFrom(url) { try { return new URL(url).host; } catch { return ""; } }

function originAllowed(origin) {
  if (!origin) return true; // same-origin / server-to-server
  const oh = hostFrom(origin);

  for (const o of ALLOW_LIST) {
    const h = hostFrom(o);
    if (o === origin || (h && h === oh)) return true;
  }

  if (ALLOW_VERCEL_PREVIEWS && oh.endsWith(".vercel.app")) return true;
  if (ALLOW_NGROK_PREVIEWS && (oh.endsWith(".ngrok-free.app") || oh.endsWith(".ngrok.app"))) return true;

  return false;
}

const corsOptions = {
  origin(origin, cb) {
    const ok = originAllowed(origin);
    if (ok) return cb(null, true);
    console.warn(
      "[CORS] Blocked:", origin,
      "Allowed:", ALLOW_LIST,
      `VercelPreviews=${ALLOW_VERCEL_PREVIEWS}`,
      `Ngrok=${ALLOW_NGROK_PREVIEWS}`
    );
    return cb(new Error("CORS blocked"));
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["Content-Length", "X-Request-Id"],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));


app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

/* ------------------- Webhooks need raw body ------------------- */
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

// JSON after webhooks
app.use(express.json());

/* ------------------- Auth Middleware ------------------- */
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    aconst: {}; // keep diff minimal; no-op
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email || null, role: isAdmin(decoded.uid) ? "admin" : "user" };
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

/* ------------------- 🔒 Sanitizers (inline) ------------------- */
function sanitizePro(doc, viewerRole = "user") {
  if (!doc) return doc;
  const o = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  if (viewerRole !== "admin") {
    delete o.ownerUid;
    delete o.__v;
  }
  return o;
}
function sanitizeBarberCard(obj, viewerRole = "user") {
  const o = { ...(obj || {}) };
  if (viewerRole !== "admin") {
    delete o.ownerUid;
    delete o.uid;
  }
  return o;
}

/* ------------------- Maintenance Mode Gate ------------------- */
function maintenanceBypass(req) {
  if (req.path === "/api/health") return true;
  if (req.path.startsWith("/api/paystack/webhook")) return true;
  if (req.path.startsWith("/api/settings")) return true;
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
        if (decoded?.uid && isAdmin(decoded.uid)) return next();
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

/* ------------------- CLIENT PROFILE (GET full) ------------------- */
// replaces the earlier minimal read-only version so pages (Register/Settings) can preload everything
app.get("/api/profile/client/me", requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });
    const col = mongoose.connection.db.collection("profiles");
    const p = await col.findOne({ uid: req.user.uid });
    if (!p) return res.json(null);
    // hide uid from owners/clients
    const { uid, __v, ...safe } = p || {};
    return res.json(safe);
  } catch (e) {
    console.error("[clientProfile:GET] error:", e?.message || e);
    res.status(500).json({ error: "failed" });
  }
});

/* ------------------- CLIENT PROFILE (PUT upsert) ------------------- */
app.put("/api/profile/client/me", requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });
    const col = mongoose.connection.db.collection("profiles");

    const b = req.body || {};
    const now = new Date();

    // normalize
    const state = (b.state || "").toString().trim();
    const lga = (b.lga || "").toString().toUpperCase().trim();

    const doc = {
      uid: req.user.uid,
      email: req.user.email || "",
      fullName: (b.fullName || "").toString().trim(),
      phone: (b.phone || "").toString().trim(),
      state,
      lga,
      // keep both keys for backward compatibility
      houseAddress: (b.houseAddress || b.address || "").toString().trim(),
      address: (b.houseAddress || b.address || "").toString().trim(),
      photoUrl: b.photoUrl || "",
      lat: Number.isFinite(b.lat) ? b.lat : b.lat ?? null,
      lon: Number.isFinite(b.lon) ? b.lon : b.lon ?? null,
      acceptedTerms: !!b.acceptedTerms,
      acceptedPrivacy: !!b.acceptedPrivacy,
      agreements: {
        terms: !!(b.agreements?.terms ?? b.acceptedTerms),
        privacy: !!(b.agreements?.privacy ?? b.acceptedPrivacy),
      },
      // optional KYC blob
      kyc: b.kyc
        ? {
            idType: b.kyc.idType || "",
            idUrl: b.kyc.idUrl || "",
            selfieWithIdUrl: b.kyc.selfieWithIdUrl || "",
            livenessUrl: b.kyc.livenessUrl || "",
            status: b.kyc.status || "pending",
          }
        : undefined,
      updatedAt: now,
    };

    await col.updateOne(
      { uid: req.user.uid },
      {
        $set: doc,
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    // return sanitized doc
    const saved = await col.findOne({ uid: req.user.uid });
    const { uid, __v, ...safe } = saved || {};
    return res.json({ ok: true, profile: safe });
  } catch (e) {
    console.error("[clientProfile:PUT] error:", e?.message || e);
    res.status(500).json({ error: "save_failed" });
  }
});

/* ------------------- Enforce verified name/phone on bookings POST ------------------- */
app.use("/api/bookings", requireAuth, async (req, _res, next) => {
  try {
    if (req.method !== "POST") return next();
    if (mongoose.connection.readyState !== 1) return next();

    const col = mongoose.connection.db.collection("profiles");
    const p = await col.findOne(
      { uid: req.user.uid },
      { projection: { fullName: 1, phone: 1 } }
    );
    const fullName = p?.fullName || "";
    const phone = p?.phone || "";

    req.body = req.body || {};
    req.body.clientName = fullName || req.body.clientName || "";
    req.body.clientPhone = phone || req.body.clientPhone || "";
    req.body.client = {
      ...(req.body.client || {}),
      name: fullName || req.body?.client?.name || "",
      phone: phone || req.body?.client?.phone || "",
    };
    req.body.clientUid = req.user.uid;
    next();
  } catch {
    next();
  }
});

/* ------------------- Routers ------------------- */
app.use("/api", bookingsRouter);

/** 🔒 Pro payout write-ops guard */
app.use("/api/wallet", requireAuth, (req, res, next) => {
  const write =
    req.method === "POST" || req.method === "PUT" || req.method === "DELETE" || req.method === "PATCH";
  if (!write) return next();
  return requirePro(req, res, next);
});
/** ✅ Client wallet read stub */
app.get("/api/wallet/client/me", requireAuth, async (_req, res) => {
  res.json({ creditsKobo: 0, transactions: [] });
});

app.use("/api", walletWithAuth(requireAuth, requireAdmin));
app.use("/api", pinRoutes({ requireAuth, Application })); // /pin/me/*
app.use("/api", profileRouter);
app.use("/api", postsRouter);
app.use("/api", paymentsRouter({ requireAuth })); // mounts /payments/*

/* ----- Optional availability router ----- */
try {
  const { default: availabilityRouter } = await import("./routes/availability.js").catch(() => ({
    default: null,
  }));
  if (availabilityRouter) {
    app.use("/api", availabilityRouter);
    console.log("[api] ✅ Availability routes mounted");
  } else {
    console.log("[api] ℹ️ Availability routes not present (skipped)");
  }
} catch {}

/* ------------------- Admin & Pros endpoints required by your frontend ------------------- */

app.get("/api/settings/admin", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const s = await loadSettings();
    res.json(s);
  } catch (e) {
    console.error("[settings:admin:get]", e?.message || e);
    res.status(500).json({ error: "failed" });
  }
});

async function saveSettingsAndRestart(req, res) {
  try {
    const doc = await updateSettings(req.body || {}, req.user?.email || req.user?.uid || "admin");
    await restartSchedulers().catch((e) => console.warn("[settings] restart warn:", e?.message || e));
    res.json(doc);
  } catch (err) {
    console.error("[settings:put]", err?.message || err);
    res.status(500).json({ error: "failed" });
  }
}
app.put("/api/settings", requireAuth, requireAdmin, saveSettingsAndRestart);
app.put("/api/settings/admin", requireAuth, requireAdmin, saveSettingsAndRestart);

app.get("/api/pros/pending", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const docs = await Application.find({ status: { $in: ["submitted", "pending"] } })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json(docs || []);
  } catch (e) {
    console.error("[pros:pending]", e?.message || e);
    res.status(500).json({ error: "failed" });
  }
});

app.post("/api/pros/approve/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const appDoc =
      (await Application.findById(id)) ||
      (await Application.findOne({ clientId: id })) ||
      null;

    if (!appDoc) return res.status(404).json({ error: "application_not_found" });

    const ownerUid = appDoc.uid;
    if (!ownerUid) return res.status(400).json({ error: "missing_applicant_uid" });

    const base = {
      ownerUid,
      name:
        appDoc.displayName ||
        [appDoc?.identity?.firstName, appDoc?.identity?.lastName].filter(Boolean).join(" ") ||
        appDoc.email ||
        "Unnamed Pro",
      email: appDoc.email || "",
      phone: appDoc.phone || appDoc?.identity?.phone || "",
      lga:
        (appDoc.lga ||
          appDoc?.identity?.city ||
          appDoc?.identity?.state ||
          "").toString().toUpperCase(),
      identity: appDoc.identity || {},
      professional: appDoc.professional || {},
      availability: appDoc.availability || {},
      bank: appDoc.bank || {},
      status: "approved",
    };

    const pro = await Pro.findOneAndUpdate(
      { ownerUid },
      { $set: base },
      { new: true, upsert: true }
    );

    appDoc.status = "approved";
    appDoc.approvedAt = new Date();
    await appDoc.save();

    res.json({ ok: true, proId: pro._id.toString(), applicationId: appDoc._id.toString() });
  } catch (err) {
    console.error("[pros/approve]", err?.message || err);
    res.status(500).json({ error: "approve_failed" });
  }
});

app.post("/api/admin/release-booking/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return res.status(400).json({ error: "invalid_booking_id" });

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ error: "booking_not_found" });

    if (booking.payoutReleased === true) {
      return res.json({ ok: true, alreadyReleased: true });
    }

    const outcome = await releasePendingToAvailableForBooking(booking, { reason: "admin_manual_release" });
    if (!outcome?.ok) return res.status(400).json({ error: "release_failed", details: outcome });

    res.json({
      ok: true,
      releasedKobo: outcome.releasedKobo || 0,
      walletId: outcome.walletId || null,
      bookingId: booking._id.toString(),
    });
  } catch (err) {
    console.error("[admin:release-booking]", err?.message || err);
    res.status(500).json({ error: "release_error" });
  }
});

/* ------------------- Minimal /api/pros/me (for Settings page) ------------------- */
app.get("/api/pros/me", requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });
    const pro = await Pro.findOne({ ownerUid: req.user.uid });
    if (!pro) return res.json(null);
    res.json(sanitizePro(pro, req.user.role));
  } catch (e) {
    console.error("[pros:me:get]", e?.message || e);
    res.status(500).json({ error: "failed" });
  }
});

app.put("/api/pros/me", requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database not connected" });
    const existing = await Pro.findOne({ ownerUid: req.user.uid });
    if (!existing) return res.status(400).json({ error: "no_pro_profile" });

    const payload = req.body || {};
    const allowed = {
      name: payload.name ?? existing.name,
      email: payload.email ?? existing.email,
      phone: payload.phone ?? existing.phone,
      lga: (payload.lga ?? existing.lga ?? "").toString().toUpperCase(),
      identity: payload.identity ?? existing.identity,
      professional: payload.professional ?? existing.professional,
      availability: payload.availability ?? existing.availability,
      bank: payload.bank ?? existing.bank,
      status: payload.status ?? existing.status,
    };

    Object.assign(existing, allowed);
    await existing.save();

    res.json({ ok: true, item: sanitizePro(existing, req.user.role) });
  } catch (e) {
    console.error("[pros:me:put]", e?.message || e);
    res.status(500).json({ error: "failed" });
  }
});

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
    const { uid, ...rest } = doc || {};
    return res.json(rest || null);
  } catch (err) {
    console.error("[deactivation:me] error:", err);
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

    const payload = {
      email: req.user.email,
      isPro: !!pro,
      proId: pro?._id?.toString() || null,
      proName: pro?.name || null,
      lga: pro?.lga || null,
      isAdmin: isAdmin(req.user.uid),
      hasPin: !!appDoc?.withdrawPinHash,
      deactivationPending: latestDeact?.status === "pending",
      deactivationStatus: latestDeact?.status || null,
    };

    res.json(payload);
  } catch (err) {
    console.error("[me] error:", err);
    res.status(500).json({ error: "failed" });
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
    return res.json(docs.map((d) => sanitizeBarberCard(proToBarber(d))));
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
    return res.json(sanitizeBarberCard(proToBarber(doc)));
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
    `https://api.geoapify.com/v1/geocode/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(
      lon
    )}&apiKey=${encodeURIComponent(GEOAPIFY_KEY)}`
  );
  if (!r.ok) return null;
  const j = await r.json();
  return j;
}

/* ------------------- GEO reverse used by client register ------------------- */
app.get("/api/geo/rev", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: "lat_lon_required" });

    const j = await reverseGeocode(lat, lon);
    if (j?.features?.length) return res.json(j);

    // Fallback: return a minimal, compatible structure
    return res.json({
      features: [
        {
          properties: {
            state: "",
            region: "",
            county: "",
            city: "",
            district: "",
            suburb: "",
            address_line1: "",
            address_line2: "",
          },
        },
      ],
    });
  } catch (e) {
    console.error("[geo:rev] error:", e?.message || e);
    return res.json({ features: [] });
  }
});

/* ------------------- Nigeria Geo (robust) ------------------- */
app.get("/api/geo/ng", (_req, res) => {
  try {
    const states = Object.keys(NG_GEO || {});
    return res.json({ states, lgas: NG_GEO });
  } catch (e) {
    console.error("[geo/ng] error:", e);
    return res.json({ states: [], lgas: {} });
  }
});

app.get("/api/geo/ng/states", (_req, res) => {
  try {
    const states = Object.keys(NG_GEO || {});
    return res.json(states);
  } catch (e) {
    console.error("[geo/ng/states] error:", e);
    return res.json([]);
  }
});

app.get("/api/geo/ng/lgas/:state", (req, res) => {
  try {
    const st = decodeURIComponent(req.params.state || "").trim();
    const lgas = (NG_GEO && NG_GEO[st]) || [];
    if (!Array.isArray(lgas) || lgas.length === 0) {
      return res.status(404).json({ error: "state_not_found" });
    }
    return res.json(lgas);
  } catch (e) {
    console.error("[geo/ng/lgas/:state] error:", e);
    return res.status(404).json({ error: "state_not_found" });
  }
});

/* ------------------- WebRTC: ICE servers ------------------- */
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

/* ------------------- ☁️ Cloudinary SDK config ------------------- */
const CLOUDINARY_CLOUD_NAME =
  process.env.CLOUDINARY_CLOUD_NAME ||
  process.env.VITE_CLOUDINARY_CLOUD_NAME ||
  process.env.CLOUDINARY_CLOUD ||
  process.env.VITE_CLOUDINARY_CLOUD ||
  "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
  console.log("[cloudinary] ✅ SDK configured");
} else {
  console.warn("[cloudinary] ⚠️ Missing env (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET). Signed uploads disabled.");
}

/* ------------------- ☁️ Signed uploads helper ------------------- */
app.post("/api/uploads/sign", requireAuth, async (req, res) => {
  try {
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      return res.status(500).json({ error: "cloudinary_env_missing" });
    }
    const folder = (req.body && req.body.folder) || "kpocha/pro-apps";
    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = { folder, timestamp };
    const signature = cloudinary.utils.api_sign_request(paramsToSign, CLOUDINARY_API_SECRET);

    res.json({
      cloudName: CLOUDINARY_CLOUD_NAME,
      apiKey: CLOUDINARY_API_KEY,
      timestamp,
      signature,
      folder,
    });
  } catch (e) {
    console.error("[cloudinary:sign] error", e?.message || e);
    res.status(500).json({ error: "sign_failed" });
  }
});

/* ------------------- ☁️ Optional server-side liveness upload ------------------- */
app.post("/api/uploads/liveness", requireAuth, express.json({ limit: "50mb" }), async (req, res) => {
  try {
    if (!CLOUDINARY_API_SECRET) return res.status(500).json({ error: "cloudinary_env_missing" });

    const dataUrl = req.body?.dataUrl;
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
      return res.status(400).json({ error: "invalid_data" });
    }

    const folder = "kpocha/pro-apps/liveness";
    const result = await cloudinary.uploader.upload(dataUrl, {
      folder,
      resource_type: "video",
      overwrite: true,
      context: { owner_uid: req.user.uid },
    });

    return res.json({
      ok: true,
      url: result.secure_url,
      publicId: result.public_id,
      bytes: result.bytes,
      format: result.format,
      duration: result.duration,
    });
  } catch (e) {
    console.error("[cloudinary:liveness] upload error", e?.message || e);
    res.status(500).json({ error: "upload_failed" });
  }
});

/* ------------------- Chatbase user verification ------------------- */
const CHATBASE_SECRET = process.env.CHATBASE_SECRET || "";
const CHATBASE_EXPOSE_UID = (process.env.CHATBASE_EXPOSE_UID || "false").toLowerCase() === "true";

app.get("/api/chatbase/userhash", requireAuth, async (req, res) => {
  try {
    if (!CHATBASE_SECRET) return res.status(500).json({ error: "chatbase_secret_missing" });
    const userId = req.user.uid;
    const userHash = crypto.createHmac("sha256", CHATBASE_SECRET).update(userId).digest("hex");
    return res.json(CHATBASE_EXPOSE_UID ? { userId, userHash } : { userHash });
  } catch (e) {
    return res.status(500).json({ error: "hash_failed" });
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
