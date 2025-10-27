// apps/api/routes/payout.js
import express from "express";

export default function payoutRoutes({ requireAuth, Application }) {
  const router = express.Router();
  const t = (v) => String(v ?? "").trim();

  // Save/update payout bank details for the signed-in user
  router.put("/payout/me", requireAuth, async (req, res) => {
    try {
      const accountNumber = t(req.body?.accountNumber);
      const bankCode = t(req.body?.bankCode);
      const bankName = t(req.body?.bankName);
      const accountName = t(req.body?.accountName);

      if (!accountNumber || !bankCode || !bankName || !accountName) {
        return res.status(400).json({ error: "all_fields_required" });
      }

      const doc = await Application.findOneAndUpdate(
        { uid: req.user.uid },
        {
          $set: {
            "payoutBank.accountNumber": accountNumber,
            "payoutBank.code": bankCode,
            "payoutBank.name": bankName,
            "payoutBank.accountName": accountName,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      // Return only the payoutBank portion
      return res.json({ ok: true, payoutBank: doc?.payoutBank || null });
    } catch (err) {
      console.error("[payout/me] error:", err);
      return res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}
