// apps/api/routes/pin.js
import express from "express";
import bcrypt from "bcryptjs";

/**
 * Mount with:
 *   app.use("/api", pinRoutes({ requireAuth, Application }));
 *
 * Endpoints:
 *   POST /api/pin/me/set
 *   PUT  /api/pin/me/reset
 *   PUT  /api/pin/me/forgot
 *   GET  /api/pin/me/status
 */
export default function pinRoutes({ requireAuth, Application }) {
  const router = express.Router();

  /* --------------------------- helpers --------------------------- */
  const isValidPin = (p) => typeof p === "string" && /^[0-9]{4,6}$/.test(p);
  const hashPin = async (pin) => bcrypt.hash(pin, 10);          // simplified salt
  const verifyPin = (pin, hash) => bcrypt.compare(pin || "", hash || "");

  async function getOrCreateApp(uid, email) {
    let doc = await Application.findOne({ uid });
    if (!doc) {
      doc = await Application.create({
        uid,
        email: email || null,
        status: "pending",
      });
    }
    return doc;
  }

  // simple in-memory rate limiter (resets every 10 min)
  const recent = new Map();
  const RATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };
  function hitLimit(uid) {
    const now = Date.now();
    const data = recent.get(uid) || { count: 0, ts: now };
    if (now - data.ts > RATE_LIMIT.windowMs) {
      recent.set(uid, { count: 1, ts: now });
      return false;
    }
    data.count++;
    recent.set(uid, data);
    return data.count > RATE_LIMIT.max;
  }

  /* --------------------------- endpoints -------------------------- */

  // Set for first time
  router.post("/pin/me/set", requireAuth, async (req, res) => {
    try {
      const uid = req.user?.uid;
      const email = req.user?.email || null;
      const pin = String(req.body?.pin || "").trim();

      if (!uid) return res.status(401).json({ error: "unauthorized" });
      if (!isValidPin(pin)) return res.status(400).json({ error: "invalid_pin_format" });

      const appDoc = await getOrCreateApp(uid, email);
      if (appDoc.withdrawPinHash) return res.status(409).json({ error: "pin_already_set" });

      appDoc.withdrawPinHash = await hashPin(pin);
      appDoc.hasPin = true;
      await appDoc.save();

      res.json({ ok: true });
    } catch (e) {
      console.error("POST /pin/me/set:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Reset with current pin
  router.put("/pin/me/reset", requireAuth, async (req, res) => {
    try {
      const uid = req.user?.uid;
      const currentPin = String(req.body?.currentPin || "").trim();
      const newPin = String(req.body?.newPin || "").trim();

      if (!uid) return res.status(401).json({ error: "unauthorized" });
      if (!isValidPin(newPin)) return res.status(400).json({ error: "invalid_pin_format" });
      if (hitLimit(uid)) return res.status(429).json({ error: "too_many_attempts" });

      const appDoc = await Application.findOne({ uid });
      if (!appDoc?.withdrawPinHash) return res.status(409).json({ error: "no_pin_to_reset" });

      const ok = await verifyPin(currentPin, appDoc.withdrawPinHash);
      if (!ok) return res.status(400).json({ error: "invalid_pin" });

      appDoc.withdrawPinHash = await hashPin(newPin);
      appDoc.hasPin = true;
      await appDoc.save();

      res.json({ ok: true });
    } catch (e) {
      console.error("PUT /pin/me/reset:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Forgot-pin (re-auth’d user)
  router.put("/pin/me/forgot", requireAuth, async (req, res) => {
    try {
      const uid = req.user?.uid;
      const email = req.user?.email || null;
      const newPin = String(req.body?.newPin || "").trim();

      if (!uid) return res.status(401).json({ error: "unauthorized" });
      if (!isValidPin(newPin)) return res.status(400).json({ error: "invalid_pin_format" });
      if (hitLimit(uid)) return res.status(429).json({ error: "too_many_attempts" });

      const appDoc = await getOrCreateApp(uid, email);
      appDoc.withdrawPinHash = await hashPin(newPin);
      appDoc.hasPin = true;
      await appDoc.save();

      res.json({ ok: true });
    } catch (e) {
      console.error("PUT /pin/me/forgot:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Quick status
  router.get("/pin/me/status", requireAuth, async (req, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) return res.status(401).json({ error: "unauthorized" });
      const doc = await Application.findOne({ uid }).lean();
      res.json({ hasPin: !!doc?.withdrawPinHash });
    } catch (e) {
      console.error("GET /pin/me/status:", e);
      res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}
