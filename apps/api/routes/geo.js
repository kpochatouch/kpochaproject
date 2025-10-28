// apps/api/routes/geo.js
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

// ----- Load ng-geo.json (36 states + FCT) with a stable path (ESM-safe) -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The data file lives at apps/api/data/ng-geo.json relative to this file
const GEO_PATH = path.resolve(__dirname, "../data/ng-geo.json");

// In-memory cache
let GEO = null;
let STATE_INDEX = null;

function normalizeStateName(s) {
  const v = String(s || "").trim().toUpperCase();
  if (!v) return "";
  if (v === "FCT" || v === "F.C.T" || v === "ABUJA") return "FEDERAL CAPITAL TERRITORY";
  // Common alternate spellings can be normalized here if needed
  return v;
}

function buildIndexFrom(geo) {
  const idx = new Map();
  for (const [state, lgas] of Object.entries(geo || {})) {
    idx.set(normalizeStateName(state), Array.isArray(lgas) ? lgas.slice() : []);
  }
  return idx;
}

function loadGeo({ force = false } = {}) {
  if (GEO && STATE_INDEX && !force) return;
  const raw = fs.readFileSync(GEO_PATH, "utf8");
  GEO = JSON.parse(raw);                // { "Abia": [ "Aba North", ... ], ... }
  STATE_INDEX = buildIndexFrom(GEO);    // Map("ABIA" -> [...])
}

// Initial load
loadGeo();

/** GET /api/geo/ng
 * Returns the full structure:
 * { country: "Nigeria", states: string[], lgas: { [state]: string[] } }
 */
router.get("/geo/ng", (_req, res) => {
  try {
    loadGeo();
    const states = Object.keys(GEO).sort((a, b) => a.localeCompare(b));
    res.json({ country: "Nigeria", states, lgas: GEO });
  } catch (e) {
    console.error("[geo/ng] error:", e);
    res.status(500).json({ error: "geo_load_failed" });
  }
});

/** GET /api/geo/states
 * Returns: string[]  (for legacy UI dropdown)
 */
router.get("/geo/states", (_req, res) => {
  try {
    loadGeo();
    const states = Object.keys(GEO).sort((a, b) => a.localeCompare(b));
    res.json(states);
  } catch (e) {
    console.error("[geo/states] error:", e);
    res.status(500).json({ error: "geo_states_failed" });
  }
});

/** GET /api/geo/lgas?state=Edo
 * Returns: string[] (LGAs for the given state, legacy UI shape)
 */
router.get("/geo/lgas", (req, res) => {
  try {
    loadGeo();
    const q = normalizeStateName(req.query.state);
    if (!q) return res.status(400).json({ error: "state_required" });

    const lgas = STATE_INDEX.get(q) || [];
    if (!lgas.length) return res.status(404).json({ error: "state_not_found_or_no_lgas" });

    res.json(lgas.slice().sort((a, b) => a.localeCompare(b)));
  } catch (e) {
    console.error("[geo/lgas] error:", e);
    res.status(500).json({ error: "geo_lgas_failed" });
  }
});

export default router;
