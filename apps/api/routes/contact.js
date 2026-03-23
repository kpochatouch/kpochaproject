//apps/api/routes/contact.js
import express from "express";
import ContactMessage from "../models/ContactMessage.js";

export default function contactRoutes({ requireAuth }) {
  const router = express.Router();

  router.post("/contact", requireAuth, async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      const email = String(req.body?.email || "").trim();
      const phone = String(req.body?.phone || "").trim();
      const subject = String(req.body?.subject || "").trim();
      const message = String(req.body?.message || "").trim();

      if (!name || !email || !subject || !message) {
        return res.status(400).json({ error: "missing_required_fields" });
      }

      const doc = await ContactMessage.create({
        userUid: req.user?.uid || "",
        name,
        email,
        phone,
        subject,
        message,
        source: "contact_form",
      });

      return res.json({
        ok: true,
        id: String(doc._id),
      });
    } catch (err) {
      console.error("[contact] submit failed:", err?.message || err);
      return res.status(500).json({ error: "contact_failed" });
    }
  });

  return router;
}
