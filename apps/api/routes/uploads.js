// apps/api/routes/uploads.js
import express from "express";
import crypto from "crypto";

export default function uploadsRoutes({ requireAuth }) {
  const r = express.Router();

  // POST /api/uploads/sign  { folder }
  // Returns: { timestamp, apiKey, signature, cloudName, folder }
  r.post("/uploads/sign", requireAuth, async (req, res) => {
    try {
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (!cloudName || !apiKey || !apiSecret) {
        return res.status(500).json({ error: "cloudinary_not_configured" });
      }

      const ts = Math.floor(Date.now() / 1000);
      const folder = (req.body?.folder || "kpocha").toString();

      // String to sign (minimal): folder=...&timestamp=... + apiSecret
      const toSign = `folder=${folder}&timestamp=${ts}${apiSecret}`;
      const signature = crypto.createHash("sha1").update(toSign).digest("hex");

      return res.json({
        ok: true,
        timestamp: ts,
        apiKey,
        signature,
        cloudName,
        folder,
      });
    } catch (e) {
      console.error("[uploads:sign] error:", e);
      res.status(500).json({ error: "sign_failed" });
    }
  });

  return r;
}
