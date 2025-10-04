// apps/api/server.js
// ESM-friendly Node server (package.json "type": "module")

import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import admin from "firebase-admin";

// ------------------- ENV -------------------
dotenv.config();
const PORT = process.env.PORT || 8080;
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// ------------------- Firebase Admin -------------------
// Uses a local service account JSON. Keep it OUT of git.
// Path: apps/api/serviceAccountKey.json
let adminReady = false;
try {
  // Import JSON as ESM
  const svc = await import("./serviceAccountKey.json", {
    assert: { type: "json" },
  });
  admin.initializeApp({
    credential: admin.credential.cert(svc.default),
  });
  adminReady = true;
  console.log("[auth] ✅ Firebase Admin initialized (service account).");
} catch (e) {
  // Fallback to ADC (useful on some clouds)
  try {
    admin.initializeApp();
    adminReady = true;
    console.log("[auth] ✅ Firebase Admin initialized (Application Default Credentials).");
  } catch (e2) {
    console.error(
      "[auth] ❌ Firebase Admin failed to initialize.\n" +
      "Place serviceAccountKey.json in apps/api/ OR configure ADC.\n",
      e2?.message || e2
    );
    process.exit(1); // Hard exit to avoid running without auth
  }
}

// Middleware to require a valid Firebase ID token
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email || null };
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ------------------- App -------------------
const app = express();
app.use(express.json());
app.use(morgan("dev"));
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: false,
  })
);

// ------------------- Demo Data -------------------
const BARBERS = [
  {
    id: "b1",
    name: "Ayo The Barber",
    lga: "OREDO",
    availability: "Available",
    rating: 4.9,
    services: [
      { name: "Haircut", price: 2000 },
      { name: "Beard Trim", price: 1500 },
    ],
  },
  {
    id: "b2",
    name: "Joyce Styles",
    lga: "EGOR",
    availability: "Busy",
    rating: 4.8,
    services: [
      { name: "Braids", price: 8000 },
      { name: "Wig Install", price: 6000 },
    ],
  },
  {
    id: "b3",
    name: "Tega Cuts",
    lga: "IKPOBA-OKHA",
    availability: "Available",
    rating: 4.7,
    services: [
      { name: "Kids Cut", price: 1500 },
      { name: "Dye", price: 3000 },
    ],
  },
];

// Dev-only store for “Become a Professional” applications (resets on restart)
const PENDING_PROS = [];

// ------------------- Routes -------------------

// Health
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Catalog
app.get("/api/barbers", (req, res) => {
  const { lga } = req.query;
  let data = BARBERS;
  if (lga) data = data.filter(b => b.lga === lga);
  res.json(data);
});

app.get("/api/barbers/:id", (req, res) => {
  const b = BARBERS.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: "Not found" });
  res.json(b);
});

// Payment (stub)
app.post("/api/payments/initialize", (req, res) => {
  const { amount, referenceNote } = req.body || {};
  res.json({
    message: "Payment initialized (demo). Replace with Paystack initialization.",
    amount,
    referenceNote,
    publicKeyHint: "uses VITE_PAYSTACK_PUBLIC_KEY in the frontend",
  });
});

// Become a Professional (protected)
app.post("/api/pros/apply", requireAuth, (req, res) => {
  const { displayName, phone, lga, services = "" } = req.body || {};
  if (!displayName || !phone || !lga) {
    return res
      .status(400)
      .json({ error: "Missing required fields: displayName, phone, lga" });
  }

  const item = {
    id: Date.now().toString(),
    uid: req.user.uid,
    email: req.user.email,
    displayName,
    phone,
    lga,
    services,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  PENDING_PROS.push(item);
  res.json({ ok: true, item });
});

// --- Dev helpers (optional) ---
if (process.env.NODE_ENV !== "production") {
  // list pending applications
  app.get("/api/pros/pending", (req, res) => res.json(PENDING_PROS));

  // approve an application (push to demo list)
  app.post("/api/pros/approve/:id", (req, res) => {
    const idx = PENDING_PROS.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    const appItem = PENDING_PROS.splice(idx, 1)[0];

    BARBERS.push({
      id: "b" + Math.floor(Math.random() * 100000),
      name: appItem.displayName,
      lga: (appItem.lga || "").toUpperCase(),
      availability: "Available",
      rating: 4.8,
      services: [
        { name: "Haircut", price: 2000 },
        { name: "Beard Trim", price: 1500 },
      ],
    });

    res.json({ ok: true });
  });
}

// ------------------- Start -------------------
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
