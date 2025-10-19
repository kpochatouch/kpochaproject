import { Router } from "express";
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

    // Soft pass-through using your nearby endpoint (25km)
    const u = new URL(req.protocol + "://" + req.get("host") + "/api/barbers/nearby");
    u.searchParams.set("lat", String(lat));
    u.searchParams.set("lon", String(lng));
    u.searchParams.set("radiusKm", "25");

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);

    const r2 = await fetch(u, { signal: ctrl.signal }).catch(() => null);
    clearTimeout(t);

    if (!r2 || !r2.ok) return res.json({ ok: true, etaMins: 10 }); // fail-soft allow
    const j = await r2.json();
    if (j?.count > 0) return res.json({ ok: true, etaMins: 10 });

    return res.json({ ok: false, reason: "NO_PRO_AVAILABLE" });
  } catch (e) {
    return res.status(200).json({ ok: true, etaMins: 10 }); // fail-soft
  }
});

export default r;
