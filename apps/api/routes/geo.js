// apps/api/routes/geo.js
import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

/** Load the Nigeria states/LGAs JSON once (with robust path resolution). */
function loadNgGeo() {
  const candidates = [
    path.resolve(process.cwd(), "apps", "api", "data", "ng-geo.json"),
    path.resolve(process.cwd(), "data", "ng-geo.json"),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../data/ng-geo.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      }
    } catch {}
  }
  return null;
}

const NG = loadNgGeo();

/** Utility: normalize state input (accepts name or code). */
function matchState(input) {
  if (!NG?.states || !input) return null;
  const s = String(input).trim();
  const lc = s.toLowerCase();
  return (
    NG.states.find((x) => String(x.code || "").toLowerCase() === lc) ||
    NG.states.find((x) => String(x.name || "").toLowerCase() === lc) ||
    null
  );
}

/** Health check (optional) */
router.get("/geo/health", (_req, res) => {
  res.json({ ok: !!NG, states: NG?.states?.length || 0 });
});

/** Full payload (big). */
router.get("/geo/ng", (_req, res) => {
  if (!NG) return res.status(500).json({ error: "ng_geo_not_loaded" });
  res.json(NG);
});

/** States list: [{ name, code }] */
router.get("/geo/states", (_req, res) => {
  if (!NG) return res.status(500).json({ error: "ng_geo_not_loaded" });
  const states = (NG.states || [])
    .map((s) => ({ name: s.name, code: s.code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(states);
});

/** LGAs for a state: /geo/lgas?state=Edo  OR  /geo/lgas?state=ED */
router.get("/geo/lgas", (req, res) => {
  if (!NG) return res.status(500).json({ error: "ng_geo_not_loaded" });
  const s = matchState(req.query.state);
  if (!s) return res.status(400).json({ error: "state_not_found" });
  const lgas = (s.lgas || []).map((n) => ({ name: n }));
  res.json({ state: { name: s.name, code: s.code }, lgas });
});

export default router;
