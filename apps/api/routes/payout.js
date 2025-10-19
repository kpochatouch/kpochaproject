// apps/api/routes/payout.js
import express from "express";

export default function payoutRoutes({ requireAuth, Application }) {
  const router = express.Router();

  /**
   * Save or update a vendor's payout bank details.
   * Required fields: accountNumber, bankCode, bankName, accountName
   */
  router.put("/payout/me", requireAuth, async (req, res) => {
    try {
      const { accountNumber, bankCode, bankName, accountName } = req.body || {};
      if (!accountNumber || !bankCode || !bankName || !accountName) {
        return res.status(400).json({ error: "all_fields_required" });
      }

      const appDoc = await Application.findOneAndUpdate(
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

      return res.json({ ok: true, payoutBank: appDoc.payoutBank });
    } catch (err) {
      console.error("[payout/me] error:", err);
      res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}
