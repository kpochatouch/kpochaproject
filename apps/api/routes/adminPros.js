// apps/api/routes/adminPros.js
import express from "express";
import mongoose from "mongoose";

export default function adminProsRoutes({
  requireAuth,
  requireAdmin,
  Application,
  Pro, // passed in from server.js
}) {
  const r = express.Router();

  // POST /api/pros/decline/:id  { reason }
  // Accepts either Application.clientId or Application._id (24-char ObjectId)
  r.post("/pros/decline/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const rawId = String(req.params.id || "");
      const reason = String(req.body?.reason || "").trim();
      if (!reason) return res.status(400).json({ error: "reason_required" });

      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: "database_not_connected" });
      }

      // try by clientId first
      let doc = await Application.findOne({ clientId: rawId });
      // fallback: try ObjectId
      if (!doc && /^[0-9a-fA-F]{24}$/.test(rawId)) {
        doc = await Application.findById(rawId);
      }
      if (!doc) return res.status(404).json({ error: "application_not_found" });

      doc.status = "rejected";
      doc.rejectedReason = reason;
      await doc.save();

      return res.json({ ok: true });
    } catch (err) {
      console.error("[admin:decline] error:", err);
      return res.status(500).json({ error: "decline_failed" });
    }
  });

  // POST /api/pros/resync/:ownerUid
  // Forces a Pro to match the latest client profile in "profiles" collection
  r.post("/pros/resync/:ownerUid", requireAuth, requireAdmin, async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: "database_not_connected" });
      }

      const ownerUid = String(req.params.ownerUid || "").trim();
      if (!ownerUid) {
        return res.status(400).json({ error: "owner_uid_required" });
      }

      // 1) find the actual Pro doc
      const pro = await Pro.findOne({ ownerUid }).lean();
      if (!pro) {
        return res.status(404).json({ error: "pro_not_found" });
      }

      // 2) read the latest client profile (same collection we used in server.js)
      const col = mongoose.connection.db.collection("profiles");
      const fresh = await col.findOne({ uid: ownerUid });
      if (!fresh) {
        // no profile to sync, but not an error
        return res.json({ ok: true, message: "no_profile_to_sync" });
      }

      // 3) build new values from profile → pro
      const name =
        fresh.fullName ||
        fresh.name ||
        [fresh?.identity?.firstName, fresh?.identity?.lastName].filter(Boolean).join(" ").trim() ||
        pro.name ||
        "";

      const phone =
        fresh.phone ||
        fresh?.identity?.phone ||
        pro.phone ||
        "";

      // normalize to uppercase — matches server.js, models.js, and web filters
      const lga = (
        fresh.lga ||
        fresh.city || // sometimes city is used
        fresh.state ||
        pro.lga ||
        ""
      )
        .toString()
        .toUpperCase();

      const state = (
        fresh.state ||
        pro.state ||
        ""
      )
        .toString()
        .toUpperCase();

      const identity = {
        ...(pro.identity || {}),
        ...(fresh.identity || {}),
      };

      const proSet = {};
      if (name) proSet.name = name;
      if (phone) proSet.phone = phone;
      if (lga) proSet.lga = lga;
      if (state) proSet.state = state;
      proSet.identity = identity;

      // 4) update Pro
      await Pro.updateOne({ ownerUid }, { $set: proSet });

      // 5) also update application docs for this user to keep admin list in sync
      const appSet = {};
      if (name) appSet.displayName = name;
      if (phone) appSet.phone = phone;
      if (lga) appSet.lga = lga;
      if (state) appSet.state = state;
      if (Object.keys(appSet).length > 0) {
        await Application.updateMany({ uid: ownerUid }, { $set: appSet });
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("[admin:pros:resync] error:", err);
      return res.status(500).json({ error: "resync_failed" });
    }
  });

  return r;
}
