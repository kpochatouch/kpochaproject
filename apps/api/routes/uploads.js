// apps/api/routes/uploads.js
import express from "express";
import crypto from "crypto";

export default function uploadsRoutes({ requireAuth }) {
  const r = express.Router();

  // POST /api/uploads/sign
  // Body (optional extras): { folder?, public_id?, overwrite?, tags? }
  // Returns: { ok, timestamp, apiKey, signature, cloudName, folder, public_id?, overwrite?, tags? }
  r.post("/uploads/sign", requireAuth, async (req, res) => {
    try {
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (!cloudName || !apiKey || !apiSecret) {
        return res.status(500).json({ error: "cloudinary_not_configured" });
      }

      const ts = Math.floor(Date.now() / 1000);

      // Whitelist params we allow the client to include in the signature
      const folder = (req.body?.folder || "kpocha").toString();
      const public_id = req.body?.public_id ? String(req.body.public_id) : undefined;
      const overwrite =
        typeof req.body?.overwrite === "boolean" ? req.body.overwrite : undefined;
      const tags = Array.isArray(req.body?.tags) ? req.body.tags.join(",") : undefined;

      // Build param string in alpha order, omit undefined/empty
      const params = { folder, timestamp: ts, public_id, overwrite, tags };
      const entries = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== "")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

      const toSign =
        entries.map(([k, v]) => `${k}=${v}`).join("&") + apiSecret; // Cloudinary: sha1 of "<params><api_secret>"
      const signature = crypto.createHash("sha1").update(toSign).digest("hex");

      return res.json({
        ok: true,
        timestamp: ts,
        apiKey,
        signature,
        cloudName,
        folder,
        ...(public_id ? { public_id } : {}),
        ...(overwrite !== undefined ? { overwrite } : {}),
        ...(tags ? { tags } : {}),
      });
    } catch (e) {
      console.error("[uploads:sign] error:", e);
      res.status(500).json({ error: "sign_failed" });
    }
  });

  return r;
}
