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

// Models & core routers
import { Application, Pro, proToBarber } from "./models.js";
import bookingsRouter from "./routes/bookings.js";
import { Booking } from "./models/Booking.js";

// Wallet & Ledger
import { withAuth as walletWithAuth } from "./routes/wallets.js";
import {
  creditProPendingForBooking,
  releasePendingToAvailableForBooking,
} from "./services/walletService.js";

// Feature routers (factories)
import pinRoutes from "./routes/pin.js";
import profileRouter from "./routes/Profile.js";
import postsRouter from "./routes/posts.js";
import commentsRouter from "./routes/comments.js";
import paymentsRouter from "./routes/payments.js";
import uploadsRoutes from "./routes/uploads.js";
import payoutRoutes from "./routes/payout.js";
import adminProsRoutes from "./routes/adminPros.js";
import geoRouter from "./routes/geo.js";
import riskRoutes from "./routes/risk.js";
import awsLivenessRoutes from "./routes/awsLiveness.js";
import redis from "./redis.js";
import postStatsRouter from "./routes/postStats.js";
import followRoutes from "./routes/follow.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;

/* ------------------- Admin config ------------------- */
const ADMIN_UIDS = (process.env.ADMIN_UIDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isAdminUid(uid) {
  return !!uid && ADMIN_UIDS.includes(uid);
}

function requireAdmin(req, res, next) {
  const uidOk = !!req.user?.uid && ADMIN_UIDS.includes(req.user.uid);
  const emailOk =
    !!req.user?.email && ADMIN_EMAILS.includes(String(req.user.email).toLowerCase());

  if (!uidOk && !emailOk) {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

/* ------------------- Firebase Admin ------------------- */
try {
  const keyPath =
    process.env.SERVICE_KEY_PATH ||
    new URL("./serviceAccountKey.json", import.meta.url).pathname;

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
        console.log(
          `[wallets] 🔧 Renamed userUid → ownerUid for ${renameRes.modifiedCount} docs`
        );
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
  {
    emailEnabled: { type: Boolean, default: false },
    smsEnabled: { type: Boolean, default: false },
  },
  { _id: false }
);

const SettingsSchema = new mongoose.Schema(
  {
    appName: { type: String, default: "Kpocha Touch" },
    tagline: { type: String, default: "Connecting You To Top Professionals" },
    commissionSplit: { type: CommissionSplitSchema, default: () => ({}) },
    payouts: { type: PayoutsSchema, default: () => ({}) },
    bookingRules: { type: BookingRulesSchema, default: () => ({}) },
    maintenance: { type: MaintenanceSchema, default: () => ({}) },
    notifications: { type: NotificationsSchema, default: () => ({}) },
    withdrawals: {
      type: new mongoose.Schema(
        { requireApproval: { type: Boolean, default: true } },
        { _id: false }
      ),
    },
    security: { allowedOrigins: { type: [String], default: [] } },
    webhooks: { paystack: { secret: { type: String, default: "" } } },
    updatedBy: { type: String, default: "system" },
  },
  { timestamps: true }
);
const Settings =
  mongoose.models.Settings || mongoose.model("Settings", SettingsSchema);

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

        let ok = 0,
          fail = 0;
        for (const b of toRelease) {
          try {
            const res = await releasePendingToAvailableForBooking(b, {
              reason: "auto_release_cron",
            });
            if (res?.ok) ok++;
            else fail++;
          } catch (e) {
            fail++;
            console.error(
              "[scheduler] release error for booking",
              b._id?.toString?.(),
              e?.message || e
            );
          }
        }

        console.log(
          `[scheduler] Auto-release ran in ${Math.round(
            (Date.now() - started) / 1000
          )}s. Processed=${toRelease.length}, ok=${ok}, fail=${fail}`
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
        console.log(
          `[scheduler] No-show sweep ran. Strike limit: ${strikeLimit}`
        );
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

app.set("redis", redis);

/* ------------------- CORS (hardened, with Vercel previews) ------------------- */
const ALLOW_LIST = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(/[,\s]+/g)
  .map((s) => s.trim())
  .filter(Boolean);

function originAllowed(origin) {
  if (!origin) return true;
  try {
    const oh = new URL(origin).host;
    for (const o of ALLOW_LIST) {
      try {
        if (new URL(o).host === oh) return true;
        if (o === origin) return true;
      } catch {}
    }
    if ((process.env.ALLOW_VERCEL_PREVIEWS || "true") !== "false") {
      if (oh.endsWith(".vercel.app")) return true;
    }
  } catch {}
  return false;
}

const corsOptions = {
  origin(origin, cb) {
    const ok = originAllowed(origin);
    if (ok) return cb(null, true);
    console.warn("[CORS] Blocked:", origin, "Allowed:", ALLOW_LIST);
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
      const secret =
        process.env.PAYSTACK_SECRET_KEY ||
        process.env.PAYSTACK_WEBHOOK_SECRET ||
        "";
      const signature = req.headers["x-paystack-signature"];
      const computed = crypto
        .createHmac("sha512", secret)
        .update(req.body)
        .digest("hex");
      if (!signature || signature !== computed)
        return res.status(401).send("Invalid signature");

      const event = JSON.parse(req.body.toString());
      handlePaystackEvent(event).catch((err) =>
        console.error("[paystack] handler error:", err)
      );
      res.sendStatus(200);
    } catch (err) {
      console.error("[paystack] webhook processing error:", err);
      res.sendStatus(400);
    }
  }
);

// JSON after webhooks
app.use(express.json());

/* ------------------- View identity (stable anon cookie) ------------------- */
function readCookie(header, name) {
  const m = (header || "").match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function newAnonId() {
  return (
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

app.use((req, res, next) => {
  let anonId = readCookie(req.headers.cookie || "", "anonId");

  if (!anonId) {
    anonId = newAnonId();

    const cookieFlags =
      process.env.NODE_ENV === "production"
        ? "Path=/; Max-Age=31536000; SameSite=None; Secure"
        : "Path=/; Max-Age=31536000; SameSite=Lax";

    res.setHeader("Set-Cookie", `anonId=${encodeURIComponent(anonId)}; ${cookieFlags}`);
  }

  const forwarded =
    (req.headers["x-forwarded-for"] &&
      String(req.headers["x-forwarded-for"]).split(",")[0].trim()) ||
    req.socket?.remoteAddress ||
    "";
  const ua = req.headers["user-agent"] || "";

  req.viewIdentity = {
    anonId, // <- this is now unique per browser
    ip: forwarded,
    ua,
  };

  next();
});

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

async function requirePro(req, res, next) {
  try {
    const pro = await Pro.findOne({ ownerUid: req.user.uid })
      .select("_id")
      .lean();
    if (!pro) return res.status(403).json({ error: "pro_only" });
    req.proId = pro._id.toString();
    next();
  } catch (e) {
    res.status(500).json({ error: "check_pro_failed" });
  }
}

/* ------------------- Maintenance ------------------- */
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

/* ------------------- Helpers ------------------- */
async function getVerifiedClientIdentity(uid) {
  try {
    const col = mongoose.connection.db.collection("profiles");
    const p = await col.findOne(
      { uid },
      {
        projection: {
          fullName: 1,
          name: 1,
          displayName: 1,
          phone: 1,
          identity: 1,
          photoUrl: 1,
        },
      }
    );
    if (!p) return { fullName: "", phone: "", photoUrl: "" };

    const fullName =
      p.fullName ||
      p.name ||
      p.displayName ||
      [p?.identity?.firstName, p?.identity?.middleName, p?.identity?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      "";

    const phone = p.phone || p?.identity?.phone || "";
    const photoUrl =
      p.photoUrl || p?.identity?.photoUrl || "";

    return { fullName, phone, photoUrl };
  } catch {
    return { fullName: "", phone: "", photoUrl: "" };
  }
}

// PUBLIC SANITIZER for pro/barber response
// we call this in server.js so even if proToBarber starts returning phone,
// public endpoints will not leak it.
function scrubPublicPro(p = {}) {
  const { phone, shopAddress, whatsapp, ...rest } = p;
  return rest;
}

/* ------------------- Unified current user profile summary ------------------- */
app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;

    // 1) load main profile (the single source)
    let profileDoc = null;
    try {
      const col = mongoose.connection.db.collection("profiles");
      profileDoc = await col.findOne(
        { uid },
        {
          projection: {
            displayName: 1,
            name: 1,
            fullName: 1,
            identity: 1,
            photoUrl: 1,
            hasPro: 1,
            proId: 1,
            proStatus: 1,
            phone: 1,
            state: 1,
            lga: 1,
            updatedAt: 1,
          },
        }
      );
    } catch {}

    // 2) load pro doc (may be newer)
    let proDoc = null;
    try {
      proDoc = await Pro.findOne({ ownerUid: uid })
        .select("_id name photoUrl status updatedAt")
        .lean();
    } catch {}

    // normalize times for comparison
    const profileUpdatedAt = profileDoc?.updatedAt
      ? new Date(profileDoc.updatedAt).getTime()
      : 0;
    const proUpdatedAt = proDoc?.updatedAt
      ? new Date(proDoc.updatedAt).getTime()
      : 0;

    // helper: pick non-empty value, prefer profile
    function pickName() {
      const identity = profileDoc?.identity || {};

      const profileName =
        profileDoc?.displayName ||
        profileDoc?.fullName ||
        profileDoc?.name ||
        [identity?.firstName, identity?.lastName].filter(Boolean).join(" ").trim();

      if (profileName && profileName.trim()) {
        return profileName.trim();
      }

      if (proDoc?.name && proDoc.name.trim()) {
        return proDoc.name.trim();
      }

      return req.user.email || "";
    }

    function pickPhoto() {
      const identity = profileDoc?.identity || {};

      const profilePhoto =
        profileDoc?.photoUrl ||
        identity?.photoUrl;

      if (profilePhoto && profilePhoto.trim()) {
        return profilePhoto.trim();
      }

      if (proDoc?.photoUrl && proDoc.photoUrl.trim()) {
        return proDoc.photoUrl.trim();
      }

      return "";
    }

    const displayName = pickName();
    const photoUrl = pickPhoto();
    const identity = profileDoc?.identity || {};
    const isAdmin = isAdminUid(uid);
    const isPro = !!proDoc || !!profileDoc?.hasPro;

    const payload = {
      uid,
      email: req.user.email || "",
      displayName,
      identity,
      photoUrl,
      isAdmin,
      isPro,
      pro: proDoc
        ? {
            id: proDoc._id.toString(),
            name: displayName,
            status: proDoc.status || "approved",
            photoUrl: photoUrl || "",
          }
        : profileDoc?.proId
        ? {
            id: profileDoc.proId.toString(),
            name: displayName,
            status: profileDoc.proStatus || "approved",
            photoUrl,
          }
        : null,
    };

    // make sure we never leak ownerUid
    if (payload.pro && payload.pro.ownerUid) {
      delete payload.pro.ownerUid;
    }

    res.json(payload);

  } catch (e) {
    console.error("[/api/me] error:", e?.message || e);
    res.status(500).json({ error: "failed_me" });
  }
});


// 🔐 helpers for liveness + services
// put this ABOVE the /api/pros/me routes in server.js
function isSameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

async function wasLivenessToday(uid) {
  try {
    const col = mongoose.connection.db.collection("profiles");
    const doc = await col.findOne(
      { uid },
      { projection: { livenessVerifiedAt: 1 } }
    );
    if (!doc?.livenessVerifiedAt) return false;
    return isSameDay(doc.livenessVerifiedAt, new Date());
  } catch {
    return false;
  }
}

// allow frontend to tell us “I just did liveness, remember it”
async function rememberLivenessToday(uid) {
  try {
    const col = mongoose.connection.db.collection("profiles");
    await col.updateOne(
      { uid },
      { $set: { livenessVerifiedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    console.warn("[liveness:remember] skipped:", e?.message || e);
  }
}

// what counts as “sensitive” on /api/pros/me
function bodyTouchesSensitivePro(body = {}) {
  if (!body || typeof body !== "object") return false;

  // 1) money / payouts
  if (body.bank) return true;

  // 2) real-person info
  if (body.identity) return true;

  // everything else (phone, state, lga, availability, services) → no liveness
  return false;
}

// keep service edits working after your migration
function normalizeServicesDetailed(arr = []) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (!item) return null;
      const name = (item.name || item.id || "").toString().trim();
      if (!name) return null;

      const priceRaw = (item.price ?? "").toString().replace(/,/g, "").trim();
      const promoRaw = (item.promoPrice ?? "").toString().replace(/,/g, "").trim();
      const priceNum = priceRaw === "" ? 0 : Number(priceRaw);
      const promoNum = promoRaw === "" ? null : Number(promoRaw);

      const out = {
        id: item.id || name,
        name,
        price: Number.isFinite(priceNum) ? priceNum : 0,
      };

      if (promoNum !== null && Number.isFinite(promoNum)) {
        out.promoPrice = promoNum;
      }
      if (item.description) out.description = item.description;
      if (item.durationMins) out.durationMins = Number(item.durationMins) || 0;

      return out;
    })
    .filter(Boolean);
}

/* ------------------- Pro private endpoint (owner sees full pro) ------------------- */
app.get("/api/pros/me", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const pro = await Pro.findOne({ ownerUid: uid }).lean();
    if (!pro) return res.status(404).json({ error: "pro_not_found" });

    const safe = { ...pro, uid };
    if ("ownerUid" in safe) {
      delete safe.ownerUid;
    }

    return res.json(safe);
  } catch (e) {
    console.error("[/api/pros/me] error:", e?.message || e);
    return res.status(500).json({ error: "failed" });
  }
});

/* ------------------- Pro private update (owner updates own pro) ------------------- */
app.put("/api/pros/me", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const body = req.body || {};

    const pro = await Pro.findOne({ ownerUid: uid });
    if (!pro) return res.status(404).json({ error: "pro_not_found" });

    // optional: frontend can send { liveness: { remember: true } } right after AWS
    if (body.liveness && body.liveness.remember === true) {
      await rememberLivenessToday(uid);
    }

    // if they are editing sensitive stuff, they must have liveness today
    if (bodyTouchesSensitivePro(body)) {
      const okToday = await wasLivenessToday(uid);
      if (!okToday) {
        return res.status(403).json({ error: "liveness_required" });
      }
    }

    // helper → true if value is not empty
    const hasVal = (v) =>
      v !== undefined &&
      v !== null &&
      (typeof v !== "string" || v.trim() !== "");

    // prepare update for pro doc
    const proSet = {};

    if (hasVal(body.name)) proSet.name = body.name.trim();
    if (hasVal(body.photoUrl)) proSet.photoUrl = body.photoUrl.trim();
    if (hasVal(body.phone)) proSet.phone = body.phone.trim();
    if (hasVal(body.state)) proSet.state = body.state.toString().toUpperCase();
    if (hasVal(body.lga)) proSet.lga = body.lga.toString().toUpperCase();

    // ✅ handle services/pricing after migration
    if (Array.isArray(body.servicesDetailed)) {
      const detailed = normalizeServicesDetailed(body.servicesDetailed);
      proSet.servicesDetailed = detailed;

      // keep professional.services in sync
      const names = detailed.map((d) => d.name).filter(Boolean);
      proSet.professional = {
        ...(pro.professional || {}),
        ...(body.professional || {}),
        services: names,
      };

      // also keep top-level services list that your browse uses
      proSet.services = detailed.map((d) => ({
        name: d.name,
        price: d.price,
        description: d.description || "",
        durationMins: d.durationMins || 0,
        visible: true,
      }));
    } else if (body.professional) {
      proSet.professional = body.professional;
    }

    if (body.availability) proSet.availability = body.availability;
    if (body.bank) proSet.bank = body.bank;
    if (typeof body.bio === "string") proSet.bio = body.bio;

    proSet.status = hasVal(body.status) ? body.status : pro.status || "approved";

    const updated = await Pro.findOneAndUpdate(
      { ownerUid: uid },
      { $set: proSet },
      { new: true }
    ).lean();

    // 🔁 Sync same non-empty values back to profiles (two-way, last edit wins)
    try {
      const col = mongoose.connection.db.collection("profiles");
      const toSet = {
        uid,
        hasPro: true,
        proStatus: updated.status,
        proId: updated._id,
      };

      if (hasVal(body.name)) {
        toSet.displayName = body.name.trim();
        toSet.fullName = body.name.trim();
        toSet.name = body.name.trim();
      }
      if (hasVal(body.photoUrl)) {
        toSet.photoUrl = body.photoUrl.trim();
      }
      if (hasVal(body.phone)) {
        toSet.phone = body.phone.trim();
      }
      if (hasVal(body.state)) toSet.state = body.state.toString().toUpperCase();
      if (hasVal(body.lga)) toSet.lga = body.lga.toString().toUpperCase();

      if (
        body.availability &&
        Array.isArray(body.availability.statesCovered)
      ) {
        toSet.statesCovered = body.availability.statesCovered.map((s) =>
          s.toString().toUpperCase()
        );
      }

      // also persist today’s liveness if they asked us to remember it
      if (body.liveness && body.liveness.remember === true) {
        toSet.livenessVerifiedAt = new Date();
      }

      await col.updateOne({ uid }, { $set: toSet }, { upsert: true });
    } catch (syncErr) {
      console.warn("[/api/pros/me PUT] profiles sync skipped:", syncErr?.message || syncErr);
    }

    const safe = { ...updated, uid };
    if ("ownerUid" in safe) {
      delete safe.ownerUid;
    }

    return res.json({ ok: true, item: safe });
  } catch (err) {
    console.error("[/api/pros/me PUT] error:", err?.message || err);
    return res.status(500).json({ error: "pro_update_failed" });
  }
});



/** Enforce verified name/phone on bookings POST */
app.use("/api/bookings", requireAuth, async (req, _res, next) => {
  try {
    if (req.method !== "POST") return next();
    if (mongoose.connection.readyState !== 1) return next();

    const { fullName, phone } = await getVerifiedClientIdentity(req.user.uid);
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

// wallet write guard
app.use("/api/wallet", requireAuth, (req, res, next) => {
  const write =
    req.method === "POST" ||
    req.method === "PUT" ||
    req.method === "DELETE" ||
    req.method === "PATCH";
  if (!write) return next();
  return requirePro(req, res, next);
});
app.use("/api", walletWithAuth(requireAuth, requireAdmin));

app.use("/api", pinRoutes({ requireAuth, Application }));
app.use("/api", profileRouter);
app.use("/api", postsRouter);
app.use("/api", followRoutes);
app.use("/api", commentsRouter);
app.use("/api", paymentsRouter({ requireAuth }));
app.use("/api", postStatsRouter);
app.use("/api", uploadsRoutes({ requireAuth }));
app.use("/api", payoutRoutes({ requireAuth, Application }));
app.use("/api", riskRoutes({ requireAuth, requireAdmin, Application }));
app.use("/api", awsLivenessRoutes({ requireAuth }));

// admin pros
try {
  const maybe = adminProsRoutes;
  const mounted =
    typeof maybe === "function"
      ? maybe({ requireAuth, requireAdmin, Application, Pro })
      : maybe;
  if (mounted) app.use("/api", mounted);
  console.log("[api] ✅ Admin pros routes mounted");
} catch (e) {
  console.warn("[api] ℹ️ Admin pros routes not mounted:", e?.message || e);
}

// geo
try {
  if (geoRouter) {
    app.use("/api", geoRouter);
    console.log("[api] ✅ Geo routes mounted");
  }
} catch (e) {
  console.warn("[api] ℹ️ Geo routes not mounted:", e?.message || e);
}

// optional availability
try {
  const { default: availabilityRouter } = await import("./routes/availability.js").catch(
    () => ({ default: null })
  );
  if (availabilityRouter) {
    app.use("/api", availabilityRouter);
    console.log("[api] ✅ Availability routes mounted");
  } else {
    console.log("[api] ℹ️ Availability routes not present (skipped)");
  }
} catch {}

/* ------------------- Public settings ------------------- */
app.get("/api/settings", async (_req, res) => {
  try {
    const s = await loadSettings();
    res.json({
      appName: s.appName,
      tagline: s.tagline,
      payouts: s.payouts,
      bookingRules: s.bookingRules,
      maintenance: s.maintenance,
      updatedAt: s.updatedAt,
    });
  } catch (e) {
    res.status(500).json({ error: "failed" });
  }
});

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
    const doc = await updateSettings(req.body || {}, req.user?.uid || "admin");
    await restartSchedulers().catch((e) =>
      console.warn("[settings] restart warn:", e?.message || e)
    );
    res.json(doc);
  } catch (err) {
    console.error("[settings:put]", err?.message || err);
    res.status(500).json({ error: "failed" });
  }
}
app.put("/api/settings", requireAuth, requireAdmin, saveSettingsAndRestart);
app.put("/api/settings/admin", requireAuth, requireAdmin, saveSettingsAndRestart);

/* ------------------- Pros Admin ------------------- */
app.get("/api/pros/pending", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const docs = await Application.find({
      status: { $in: ["submitted", "pending"] },
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    res.json(docs || []);
  } catch (e) {
    console.error("[pros:pending]", e?.message || e);
    res.status(500).json({ error: "failed" });
  }
});

// small helper to coerce prices coming from forms like "15,000"
function toKpochaNumber(val) {
  if (val === null || val === undefined) return 0;
  const num = Number(String(val).replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : 0;
}

/** Approve application → upsert Pro, and mark profile as hasPro */
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

    // pull freshest profile, so we can sync photo + phone + lga
    let freshProfile = null;
    try {
      const col = mongoose.connection.db.collection("profiles");
      freshProfile = await col.findOne({ uid: ownerUid });
      if (freshProfile) {
        appDoc.displayName =
          freshProfile.fullName ||
          freshProfile.name ||
          [freshProfile?.identity?.firstName, freshProfile?.identity?.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          appDoc.displayName;
        appDoc.phone =
          freshProfile.phone ||
          freshProfile?.identity?.phone ||
          appDoc.phone;
        appDoc.lga = (
          freshProfile.lga ||
          freshProfile.state ||
          appDoc.lga ||
          ""
        )
          .toString()
          .toUpperCase();
        appDoc.identity = {
          ...(appDoc.identity || {}),
          ...(freshProfile.identity || {}),
        };
        // keep photo too
        if (freshProfile.photoUrl || freshProfile?.identity?.photoUrl) {
          appDoc.identity.photoUrl =
            freshProfile.photoUrl || freshProfile?.identity?.photoUrl;
        }
      }
    } catch (e) {
      console.warn("[approve:profile sync] skipped:", e?.message || e);
    }

    // coords
    const lat = Number(
      appDoc?.business?.lat ?? appDoc?.identity?.lat ?? appDoc?.lat
    );
    const lon = Number(
      appDoc?.business?.lon ?? appDoc?.identity?.lon ?? appDoc?.lon
    );
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);

    // normalize services
    let derivedServices = [];

    // 1) from servicesDetailed (your BecomePro.jsx sends this)
    if (Array.isArray(appDoc.servicesDetailed) && appDoc.servicesDetailed.length) {
      derivedServices = appDoc.servicesDetailed
        .map((s) => {
          const name = (s.name || s.id || "").trim();
          if (!name) return null;
          const price = toKpochaNumber(s.price || s.promoPrice || 0);
          return {
            name,
            price,
            visible: true,
            description: s.description || "",
            durationMins: toKpochaNumber(s.durationMins || 0),
          };
        })
        .filter(Boolean);
    }

    // 2) fallback: from professional.services
    if (
      !derivedServices.length &&
      appDoc?.professional &&
      Array.isArray(appDoc.professional.services)
    ) {
      derivedServices = appDoc.professional.services
        .map((s) =>
          typeof s === "string"
            ? {
                name: s,
                price: 0,
                visible: true,
                description: "",
                durationMins: 0,
              }
            : {
                name: s.name || "",
                price: toKpochaNumber(s.price),
                visible: typeof s.visible === "boolean" ? s.visible : true,
                description: s.description || "",
                durationMins: toKpochaNumber(s.durationMins || 0),
              }
        )
        .filter((s) => s.name);
    }

    const base = {
      ownerUid,
      name:
        appDoc.displayName ||
        [appDoc?.identity?.firstName, appDoc?.identity?.lastName]
          .filter(Boolean)
          .join(" ") ||
        appDoc.email ||
        "Unnamed Pro",
      email: appDoc.email || "",
      phone: appDoc.phone || appDoc?.identity?.phone || "",
      lga: (
        appDoc.lga ||
        appDoc?.identity?.city ||
        appDoc?.identity?.state ||
        ""
      )
        .toString()
        .toUpperCase(),
      identity: appDoc.identity || {},
      professional: appDoc.professional || {},
      availability: appDoc.availability || {},
      bank: appDoc.bank || {},
      status: "approved",
      ...(derivedServices.length ? { services: derivedServices } : {}),
      ...(hasCoords ? { loc: { type: "Point", coordinates: [lon, lat] } } : {}),
    };

    // 🔁 merge profile ONLY to fill blanks – approved application wins
    const hasVal = (v) =>
      v !== undefined &&
      v !== null &&
      (typeof v !== "string" || v.trim() !== "");

    if (freshProfile) {
      // name/display
      if (!hasVal(base.name) && hasVal(freshProfile.fullName)) {
        base.name = freshProfile.fullName;
        base.displayName = freshProfile.fullName;
        base.fullName = freshProfile.fullName;
      } else if (!hasVal(base.name) && hasVal(freshProfile.displayName)) {
        base.name = freshProfile.displayName;
        base.displayName = freshProfile.displayName;
      } else if (!hasVal(base.name) && hasVal(freshProfile.name)) {
        base.name = freshProfile.name;
      }

      // phone
      if (!hasVal(base.phone) && hasVal(freshProfile.phone)) {
        base.phone = freshProfile.phone;
      }

      // photo
      if (!hasVal(base.photoUrl) && hasVal(freshProfile.photoUrl)) {
        base.photoUrl = freshProfile.photoUrl;
      } else if (!hasVal(base.photoUrl) && hasVal(freshProfile.identity?.photoUrl)) {
        base.photoUrl = freshProfile.identity.photoUrl;
      }

      // state / lga
      if (!hasVal(base.state) && hasVal(freshProfile.state)) {
        base.state = freshProfile.state;
      }
      if (!hasVal(base.lga) && hasVal(freshProfile.lga)) {
        base.lga = freshProfile.lga.toString().toUpperCase();
      }
    }

    const pro = await Pro.findOneAndUpdate(
      { ownerUid },
      { $set: base },
      { new: true, upsert: true }
    );

try {
  const col = mongoose.connection.db.collection("profiles");
  const userUid = ownerUid; // we got it from the application, but it's the user's UID

  await col.updateOne(
    { uid: userUid },
    {
      $set: {
        uid: userUid,
        hasPro: true,
        proId: pro._id,
        proStatus: "approved",
        ...(pro.photoUrl ? { photoUrl: pro.photoUrl } : {}),
      },
    },
    { upsert: true }
  );
} catch (e) {
  console.warn("[approve:profile flag] skipped", e?.message || e);
}

    appDoc.status = "approved";
    appDoc.approvedAt = new Date();
    await appDoc.save();

    res.json({
      ok: true,
      proId: pro._id.toString(),
      applicationId: appDoc._id.toString(),
    });
  } catch (err) {
    console.error("[pros/approve]", err?.message || err);
    res.status(500).json({ error: "approve_failed" });
  }
});

/** Admin: view single application */
app.get("/api/applications/:id/admin", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const doc =
      (await Application.findById(id).lean()) ||
      (await Application.findOne({ clientId: id }).lean());
    if (!doc) return res.status(404).json({ error: "application_not_found" });
    res.json(doc);
  } catch (e) {
    console.error("[applications:admin:view]", e?.message || e);
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
      console.log("[reset] ✅ MongoDB collections cleared.");
    }
    res.json({ ok: true, message: "All applications, pros, bookings deleted." });
  } catch (err) {
    console.error("[reset] ❌ Reset error:", err);
    res.status(500).json({ error: "Failed to reset database" });
  }
});

/* ------------------- Health ------------------- */
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

/* ------------------- Barbers ------------------- */
app.get("/api/barbers", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database not connected" });
    }

    const stateRaw = (req.query.state || "").trim();
    const lgaRaw = (req.query.lga || "").trim();
    const serviceRaw = (req.query.service || "").trim();

    const and = [];

    if (stateRaw) {
      const re = new RegExp(`^${escapeRegex(stateRaw)}$`, "i");
      and.push({
        $or: [{ state: re }, { "identity.state": re }],
      });
    }

    if (lgaRaw) {
      const re = new RegExp(`^${escapeRegex(lgaRaw)}$`, "i");
      and.push({
        $or: [{ lga: re }, { "identity.city": re }],
      });
    }

    if (serviceRaw) {
      const re = new RegExp(escapeRegex(serviceRaw), "i");
      and.push({
        $or: [
          { services: { $elemMatch: { $regex: re } } },
          { "services.name": { $regex: re } },
          { "servicesDetailed.name": { $regex: re } },
        ],
      });
    }

    const query = and.length ? { $and: and } : {};

    const docs = await Pro.find(query).lean();
    // scrub public so phone/address don't leak
    const shaped = docs.map((d) => scrubPublicPro(proToBarber(d)));
    return res.json(shaped);
  } catch (err) {
    console.error("[barbers] DB error:", err);
    res.status(500).json({ error: "Failed to load barbers" });
  }
});

function escapeRegex(str = "") {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

app.get("/api/barbers/:id", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1)
      return res.status(503).json({ error: "Database not connected" });
    const doc = await Pro.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: "Not found" });
    // scrub public
    return res.json(scrubPublicPro(proToBarber(doc)));
  } catch (err) {
    console.error("[barbers:id] DB error:", err);
    res.status(500).json({ error: "Failed to load barber" });
  }
});

/* ------------------- Contact for booking (restricted) ------------------- */
app.get(
  "/api/pros/:id/contact-for-booking/:bookingId",
  requireAuth,
  async (req, res) => {
    try {
      const pro = await Pro.findById(req.params.id).lean();
      if (!pro) return res.status(404).json({ error: "pro_not_found" });

      const booking = await Booking.findById(req.params.bookingId).lean();
      if (!booking) return res.status(404).json({ error: "booking_not_found" });

      const isAdmin = isAdminUid(req.user.uid);
      const isClient = booking.clientUid === req.user.uid;
      const isProOwner = pro.ownerUid === req.user.uid;

      if (!isAdmin && !isClient && !isProOwner) {
        return res.status(403).json({ error: "not_allowed" });
      }

      const phone =
        pro?.contactPublic?.phone ||
        pro?.phone ||
        pro?.identity?.phone ||
        "";

      const shopAddress =
        pro?.contactPublic?.shopAddress ||
        pro?.business?.shopAddress ||
        "";

      return res.json({
        ok: true,
        phone,
        shopAddress,
        whatsapp: pro?.contactPublic?.whatsapp || "",
      });
    } catch (e) {
      console.error(
        "[/api/pros/:id/contact-for-booking] error:",
        e?.message || e
      );
      return res.status(500).json({ error: "failed" });
    }
  }
);

/* ------------------- Barbers Nearby ------------------- */
const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY || "";

async function reverseGeocode(lat, lon) {
  if (!GEOAPIFY_KEY) return null;
  const r = await fetch(
    `https://api.geoapify.com/v1/geocode/reverse?lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lon)}&apiKey=${encodeURIComponent(GEOAPIFY_KEY)}`
  );
  if (!r.ok) return null;
  const j = await r.json();
  const p = j?.features?.[0]?.properties || {};
  const state = (p.state || p.region || "").toString().toUpperCase();
  const lga = (p.county || p.city || p.district || p.suburb || "").toString().toUpperCase();
  return { state, lga };
}

app.get("/api/geo/rev", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: "lat_lon_required" });
    }
    if (!GEOAPIFY_KEY) {
      return res.status(500).json({ error: "geo_api_key_missing" });
    }
    const r = await fetch(
      `https://api.geoapify.com/v1/geocode/reverse?lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lon)}&apiKey=${encodeURIComponent(GEOAPIFY_KEY)}`
    );
    if (!r.ok) return res.status(502).json({ error: "geo_provider_failed" });
    const j = await r.json();
    return res.json(j);
  } catch (e) {
    console.error("[geo/rev] error:", e?.message || e);
    res.status(500).json({ error: "geo_rev_failed" });
  }
});

app.get("/api/barbers/nearby", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1)
      return res.status(503).json({ error: "Database not connected" });

    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radiusKm = Math.max(1, Math.min(200, Number(req.query.radiusKm || 25)));
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
      return res.status(400).json({ error: "lat & lon required" });

    let used = "geo",
      items = [];
    try {
      const agg = await Pro.aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [lon, lat] },
            distanceField: "dist",
            spherical: true,
            maxDistance: radiusKm * 1000,
            key: "loc",
          },
        },
        { $limit: 100 },
      ]);
      items = agg.map((d) => {
        const shaped = scrubPublicPro(proToBarber(d));
        return { ...shaped, distanceKm: Math.round((d.dist / 1000) * 10) / 10 };
      });
    } catch {
      used = "lga";
      const rev = await reverseGeocode(lat, lon);
      const lga = rev?.lga || "";
      const state = rev?.state || "";

      const q = {};
      if (state) q.state = new RegExp(`^${state}$`, "i");
      if (lga) q.lga = lga;

      const docs = await Pro.find(q).limit(100).lean();
      items = docs.map((d) => ({ ...scrubPublicPro(proToBarber(d)), distanceKm: null }));
    }

    return res.json({ mode: used, radiusKm, count: items.length, items });
  } catch (err) {
    console.error("[barbers/nearby] error:", err);
    res.status(500).json({ error: "nearby_failed" });
  }
});

/* ------------------- Chatbase user verification ------------------- */
const CHATBASE_SECRET = process.env.CHATBASE_SECRET || "";

app.get("/api/chatbase/userhash", requireAuth, async (req, res) => {
  try {
    if (!CHATBASE_SECRET) {
      return res.status(500).json({ error: "chatbase_secret_missing" });
    }
    const userId = req.user.uid;
    const userHash = crypto
      .createHmac("sha256", CHATBASE_SECRET)
      .update(userId)
      .digest("hex");
    return res.json({ userId, userHash });
  } catch (e) {
    return res.status(500).json({ error: "hash_failed" });
  }
});

/* ------------------- Applications (Become Pro) ------------------- */
app.post("/api/applications", requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database not connected" });
    }

    const payload = req.body || {};

    const first = payload?.identity?.firstName || "";
    const last = payload?.identity?.lastName || "";
    const displayName =
      payload.displayName ||
      [first, last].filter(Boolean).join(" ") ||
      req.user.email ||
      "Unnamed Applicant";

    const phone = payload?.identity?.phone || payload.phone || "";
    const lga = (
      payload.lga ||
      payload?.identity?.lga ||
      payload?.identity?.state ||
      ""
    )
      .toString()
      .toUpperCase();

    const servicesStr = Array.isArray(payload?.professional?.services)
      ? payload.professional.services.join(", ")
      : payload.services || "";

    const status = "submitted";

    const setDoc = {
      uid: req.user.uid,
      email: req.user.email || "",
      displayName,
      phone,
      lga,
      services: servicesStr,
      status,
      ...payload,
      acceptedTerms: !!payload.acceptedTerms,
      acceptedPrivacy: !!payload.acceptedPrivacy,
      agreements: {
        terms: !!payload?.agreements?.terms,
        privacy: !!payload?.agreements?.privacy,
      },
    };

    const doc = await Application.findOneAndUpdate(
      { uid: req.user.uid },
      { $set: setDoc },
      { new: true, upsert: true }
    );

    return res.json({ ok: true, id: doc._id.toString(), status: doc.status });
  } catch (e) {
    console.error("[applications:post]", e?.message || e);
    return res.status(500).json({ error: "apply_failed" });
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

/* ------------------- Start ------------------- */
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
