// apps/api/routes/matcher.js
import express from "express";
import redis from "../redis.js";
import { findCandidate } from "../services/matchingService.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Dev fallback when redis disabled
const localMatchStore = new Map(); // key -> { status, createdAt, payload, proId }
function setLocalMatch(id, obj, ttlSec = 30) {
  localMatchStore.set(id, obj);
  setTimeout(() => localMatchStore.delete(id), (ttlSec + 5) * 1000);
}
function getLocalMatch(id) {
  return localMatchStore.get(id) || null;
}
function delLocalMatch(id) {
  localMatchStore.delete(id);
}

// POST /api/match/request
router.post("/match/request", async (req, res) => {
  try {
    const body = req.body || {};
    const matchId = uuidv4();
    // increased TTL for debugging so UI doesn't time out while we inspect
    const ttlSeconds = 120; // was 30

    // debug log: record the incoming search
    console.log("[matcher] new match request:", matchId, {
      serviceName: body.serviceName,
      lat: body.lat,
      lon: body.lon,
      state: body.state,
      lga: body.lga,
    });

    if (redis) {
      await redis.hSet(`match:${matchId}`, {
        status: "searching",
        createdAt: Date.now().toString(),
        payload: JSON.stringify(body),
      });
      await redis.expire(`match:${matchId}`, ttlSeconds);
    } else {
      setLocalMatch(matchId, {
        status: "searching",
        createdAt: Date.now().toString(),
        payload: JSON.stringify(body),
      }, ttlSeconds);
      console.log("[matcher] Redis disabled — using local fallback for match:", matchId);
    }

    // try to find a candidate synchronously (fast path)
    const proId = await findCandidate(body);

    if (proId) {
      // debug: immediate found
      console.log("[matcher] immediate candidate found for", matchId, "proId:", proId);
      if (redis) {
        await redis.hSet(`match:${matchId}`, { status: "found", proId });
      } else {
        const existing = getLocalMatch(matchId) || {};
        setLocalMatch(matchId, { ...existing, status: "found", proId }, ttlSeconds);
      }
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
    let data = {};
    if (redis) {
      data = await redis.hGetAll(`match:${id}`);
      if (!data || !Object.keys(data).length) return res.status(404).json({ error: "not_found" });
    } else {
      const local = getLocalMatch(id);
      if (!local) return res.status(404).json({ error: "not_found" });
      data = local;
    }
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
    if (redis) {
      await redis.del(`match:${id}`);
    } else {
      delLocalMatch(id);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[matcher] cancel error:", err);
    res.status(500).json({ error: "matcher_cancel_failed" });
  }
});

export default router;
