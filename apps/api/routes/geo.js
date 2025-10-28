// apps/api/routes/geo.js
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

/** Load file next to this router: ../data/ng-geo.json (deterministic) */
function readRawNg() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const dataPath = path.resolve(__dirname, "../data/ng-geo.json");
    return JSON.parse(fs.readFileSync(dataPath, "utf8"));
  } catch (e) {
    console.error("[geo] failed to read ng-geo.json:", e?.message || e);
    return null;
  }
}

/** Normalize into { states: [{ name, code, lgas: [] }] } even if legacy object is used */
function normalizeNg(raw) {
  if (!raw) return { states: [] };

  // New format already: { states: [{ name, code?, lgas: [...] }, ...] }
  if (Array.isArray(raw.states)) {
    // Ensure every state has name, code, lgas
    const states = raw.states.map((s) => ({
      name: String(s.name || "").trim(),
      code: String(s.code || "").trim() || String(s.name || "").slice(0, 2).toUpperCase(),
      lgas: Array.isArray(s.lgas) ? s.lgas : [],
    })).filter((s) => s.name);
    return { states };
  }

  // Legacy format: { "Abia": [...], "Adamawa": [...] }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const states = Object.keys(raw).map((name) => ({
      name,
      code: name.slice(0, 2).toUpperCase(),
      lgas: Array.isArray(raw[name]) ? raw[name] : [],
    }));
    return { states };
  }

  return { states: [] };
}

const NG = normalizeNg(readRawNg());

/** Utility: find state by code or name (case-insensitive) */
function matchState(input) {
  if (!NG?.states?.length || !input) return null;
  const s = String(input).trim().toLowerCase();
  return (
    NG.states.find((x) => String(x.code).toLowerCase() === s) ||
    NG.states.find((x) => String(x.name).toLowerCase() === s) ||
    null
  );
}

/** Health check */
router.get("/geo/health", (_req, res) => {
  res.json({ ok: !!NG && !!NG.states?.length, states: NG.states?.length || 0 });
});

/** Full normalized payload */
router.get("/geo/ng", (_req, res) => {
  if (!NG?.states?.length) return res.status(500).json({ error: "ng_geo_not_loaded" });
  res.json(NG);
});

/** States list */
router.get("/geo/states", (_req, res) => {
  if (!NG?.states?.length) return res.status(500).json({ error: "ng_geo_not_loaded" });
  const states = NG.states
    .map((s) => ({ name: s.name, code: s.code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(states);
});

/** LGAs for a given state (name or code) */
router.get("/geo/lgas", (req, res) => {
  if (!NG?.states?.length) return res.status(500).json({ error: "ng_geo_not_loaded" });
  const s = matchState(req.query.state);
  if (!s) return res.status(400).json({ error: "state_not_found" });
  const lgas = (s.lgas || []).map((n) => ({ name: n }));
  res.json({ state: { name: s.name, code: s.code }, lgas });
});

export default router;
