// apps/api/routes/geo.js
import express from "express";
import nigeriaStatesLgasPkg from "nigeria-states-lgas";
const nigeriaStatesLgas = nigeriaStatesLgasPkg?.default || nigeriaStatesLgasPkg;

const router = express.Router();

/**
 * GET /api/geo/ng
 * Returns: { country: "Nigeria", states: string[], lgas: { [state]: string[] } }
 * — Full data for future use or external integrations
 */
router.get("/geo/ng", (_req, res) => {
  try {
    const states = nigeriaStatesLgas.getStates(); // ["Abia", "Adamawa", ...]
    const lgas = Object.fromEntries(
      states.map((st) => [st, nigeriaStatesLgas.getLGAs(st) || []])
    );
    res.json({ country: "Nigeria", states, lgas });
  } catch (e) {
    console.error("[geo/ng] error:", e);
    res.status(500).json({ error: "geo_load_failed" });
  }
});

/**
 * GET /api/geo/states
 * Returns: string[] — list of all Nigerian states
 * — Compatible with old UI dropdowns expecting plain strings
 */
router.get("/geo/states", (_req, res) => {
  try {
    const states = (nigeriaStatesLgas.getStates?.() || [])
      .slice()
      .sort((a, b) => a.localeCompare(b));
    res.json(states);
  } catch (e) {
    console.error("[geo/states] error:", e);
    res.status(500).json({ error: "geo_states_failed" });
  }
});

/**
 * GET /api/geo/lgas?state=Edo
 * Returns: string[] — list of LGAs for a given state
 * — Compatible with old UI dropdowns expecting plain strings
 */
router.get("/geo/lgas", (req, res) => {
  try {
    const state = String(req.query.state || "").trim();
    if (!state) {
      return res.status(400).json({ error: "state_required" });
    }

    const lgas = (nigeriaStatesLgas.getLGAs?.(state) || [])
      .slice()
      .sort((a, b) => a.localeCompare(b));

    if (!lgas.length) {
      return res.status(404).json({ error: "state_not_found_or_no_lgas" });
    }

    res.json(lgas);
  } catch (e) {
    console.error("[geo/lgas] error:", e);
    res.status(500).json({ error: "geo_lgas_failed" });
  }
});

export default router;
