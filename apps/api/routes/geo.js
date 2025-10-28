// apps/api/routes/geo.js
import express from "express";
import nigeriaStatesLgasPkg from "nigeria-states-lgas";
const nigeriaStatesLgas = nigeriaStatesLgasPkg?.default || nigeriaStatesLgasPkg;

const router = express.Router();

/**
 * GET /api/geo/ng
 * Returns: { country: "Nigeria", states: string[], lgas: { [state]: string[] } }
 */
router.get("/geo/ng", (_req, res) => {
  try {
    const states = nigeriaStatesLgas.getStates(); // ["Abia", ...]
    const lgas = Object.fromEntries(
      states.map((st) => [st, nigeriaStatesLgas.getLGAs(st) || []])
    );
    res.json({ country: "Nigeria", states, lgas });
  } catch (e) {
    console.error("[geo/ng] error:", e);
    res.status(500).json({ error: "geo_load_failed" });
  }
});

export default router;
