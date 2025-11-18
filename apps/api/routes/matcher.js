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

    // TTL can be adjusted via env while debugging
    const ttlSeconds = Number(process.env.MATCHER_TTL_SECONDS || 120);

    console.log("[matcher] new match request:", matchId, {
      serviceName: body.serviceName,
      lat: body.lat,
      lon: body.lon,
      state: body.state,
      lga: body.lga,
      ttlSeconds,
    });

    // create initial "searching" record (so pollers get a 200/exists while we try)
    if (redis) {
      try {
        await redis.hSet(`match:${matchId}`, {
          status: "searching",
          createdAt: String(Date.now()),
          payload: JSON.stringify(body || {}),
        });
        await redis.expire(`match:${matchId}`, ttlSeconds);
      } catch (e) {
        console.warn("[matcher] redis set failed:", e?.message || e);
      }
    } else {
      setLocalMatch(
        matchId,
        { status: "searching", createdAt: String(Date.now()), payload: body || {} },
        ttlSeconds
      );
      console.log("[matcher] Redis disabled — using local fallback for match:", matchId);
    }

    // debug: try to find a candidate synchronously (fast path)
    console.log("[matcher] debug: attempting synchronous findCandidate for", matchId);
    const proId = await findCandidate(body);

    if (proId) {
      console.log("[matcher] immediate candidate found for", matchId, "proId:", proId);

      if (redis) {
        try {
          await redis.hSet(`match:${matchId}`, { status: "found", proId: String(proId) });
          await redis.expire(`match:${matchId}`, ttlSeconds);
          console.log("[matcher] redis: set found + expire for", `match:${matchId}`, ttlSeconds);
        } catch (e) {
          console.warn("[matcher] redis update failed:", e?.message || e);
        }
      } else {
        const existing = getLocalMatch(matchId) || {};
        setLocalMatch(matchId, { ...existing, status: "found", proId: String(proId) }, ttlSeconds);
        console.log("[matcher] local: set found for", matchId);
      }

      return res.json({ ok: true, found: true, proId: String(proId), matchId });
    }

    // not found synchronously — return matchId for polling or socket wait
    console.log("[matcher] no immediate candidate for", matchId, "- returning matchId for polling");
    return res.json({ ok: true, found: false, matchId });
  } catch (err) {
    console.error("[matcher] request error:", err?.stack || err);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return res.status(500).json({ error: "matcher_error" });
  }
});

// GET /api/match/:id/status
router.get("/match/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    let data = null;

    console.log("[matcher] status request for", id);

    if (redis) {
      try {
        data = await redis.hGetAll(`match:${id}`);
      } catch (e) {
        console.warn("[matcher] redis.hGetAll failed:", e?.message || e);
        data = {};
      }
      if (!data || Object.keys(data).length === 0) {
        return res.status(404).json({ error: "not_found" });
      }
      // redis returns string fields; use them directly
      const out = { status: data.status || "searching" };
      if (data.proId) out.proId = data.proId;
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      return res.json(out);
    }

    // local fallback
    const local = getLocalMatch(id);
    if (!local) return res.status(404).json({ error: "not_found" });
    const outLocal = { status: local.status || "searching" };
    if (local.proId) outLocal.proId = local.proId;
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return res.json(outLocal);
  } catch (err) {
    console.error("[matcher] status error:", err?.stack || err);
    return res.status(500).json({ error: "matcher_status_error" });
  }
});

// POST /api/match/:id/cancel
router.post("/match/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    if (redis) {
      try {
        await redis.del(`match:${id}`);
      } catch (e) {
        console.warn("[matcher] redis.del failed:", e?.message || e);
      }
    } else {
      delLocalMatch(id);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[matcher] cancel error:", err?.stack || err);
    return res.status(500).json({ error: "matcher_cancel_failed" });
  }
});

export default router;
