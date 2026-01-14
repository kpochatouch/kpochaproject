// apps/api/routes/availability.js
import { Router } from "express";
// If your Node is <18 or you prefer consistency with other routes, keep this import:
import fetch from "node-fetch";

const r = Router();

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

r.post("/availability/check", async (req, res) => {
  try {
    const lat = toNum(req.body?.lat);
    const lng = toNum(req.body?.lng);
    if (lat === null || lng === null) {
      return res.status(400).json({ ok: false, reason: "coords_required" });
    }

    // Build a safe internal URL (respect proxies if any)
    const proto = (
      req.headers["x-forwarded-proto"] ||
      req.protocol ||
      "http"
    ).toString();
    const host = req.get("host");
    const u = new URL(`${proto}://${host}/api/barbers/nearby`);
    u.searchParams.set("lat", String(lat));
    u.searchParams.set("lon", String(lng)); // your nearby endpoint expects "lon"
    u.searchParams.set("radiusKm", "25");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);

    const r2 = await fetch(u, { signal: ctrl.signal }).catch(() => null);
    clearTimeout(timer);

    // Fail-soft: if nearby is down, allow booking with a default ETA
    if (!r2 || !r2.ok) return res.json({ ok: true, etaMins: 10 });

    const j = await r2.json();
    if (j?.count > 0) return res.json({ ok: true, etaMins: 10 });

    return res.json({ ok: false, reason: "NO_PRO_AVAILABLE" });
  } catch (_e) {
    // Fail-soft on any unexpected error
    return res.status(200).json({ ok: true, etaMins: 10 });
  }
});

export default r;
