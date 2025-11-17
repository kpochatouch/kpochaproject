import express from "express";
import redis from "../redis.js";
import { findCandidate } from "../services/matchingService.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// POST /api/match/request
// body: { lat, lon, state, lga, serviceName, maxRadiusKm }
router.post("/match/request", async (req, res) => {
  try {
    const body = req.body || {};
    const matchId = uuidv4();
    const ttlSeconds = 30; // how long this search remains valid

    // save a lightweight search record in redis
    await redis.hSet(`match:${matchId}`, {
      status: "searching",
      createdAt: Date.now().toString(),
      payload: JSON.stringify(body),
    });
    await redis.expire(`match:${matchId}`, ttlSeconds);

    // try to find a candidate synchronously (fast path)
    const proId = await findCandidate(body);

    if (proId) {
      // immediate candidate found — mark and return
      await redis.hSet(`match:${matchId}`, { status: "found", proId });
      return res.json({ ok: true, found: true, proId, matchId });
    }

    // otherwise return matchId so frontend can poll or wait via sockets
    return res.json({ ok: true, found: false, matchId });
  } catch (err) {
    console.error("[matcher] request error:", err);
    res.status(500).json({ error: "matcher_error" });
  }
});

// GET /api/match/:id/status
router.get("/match/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const data = await redis.hGetAll(`match:${id}`);
    if (!data || !Object.keys(data).length) return res.status(404).json({ error: "not_found" });
    const out = { status: data.status || "searching" };
    if (data.proId) out.proId = data.proId;
    res.json(out);
  } catch (err) {
    console.error("[matcher] status error:", err);
    res.status(500).json({ error: "matcher_status_error" });
  }
});

// POST /api/match/:id/cancel
router.post("/match/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    await redis.del(`match:${id}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[matcher] cancel error:", err);
    res.status(500).json({ error: "matcher_cancel_failed" });
  }
});

export default router;
