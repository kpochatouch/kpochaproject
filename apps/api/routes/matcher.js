// apps/api/routes/matcher.js
import express from "express";
import redis from "../redis.js"; // your existing client import
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

// TTL configurable by env, default 300s for debugging
const ttlSeconds = Number(process.env.MATCHER_TTL_SECONDS || 300);

// POST /api/match/request
router.post("/match/request", async (req, res) => {
  try {
    const body = req.body || {};
    const matchId = uuidv4();

    console.log("[matcher] new match request:", matchId, {
      serviceName: body.serviceName,
      lat: body.lat,
      lon: body.lon,
      state: body.state,
      lga: body.lga,
    });

    // create an initial searching record (so pollers will find it)
    if (redis) {
      try {
        await redis.hSet(`match:${matchId}`, {
          status: "searching",
          createdAt: Date.now().toString(),
          payload: JSON.stringify(body),
        });
        await redis.expire(`match:${matchId}`, ttlSeconds);
        console.log(
          "[matcher] redis: created match key",
          `match:${matchId}`,
          "ttl:",
          ttlSeconds,
        );
      } catch (e) {
        console.warn(
          "[matcher] redis write failed on create:",
          e?.message || e,
        );
      }
    } else {
      setLocalMatch(
        matchId,
        {
          status: "searching",
          createdAt: Date.now().toString(),
          payload: JSON.stringify(body),
        },
        ttlSeconds,
      );
      console.log(
        "[matcher] using local fallback for match:",
        matchId,
        "ttl:",
        ttlSeconds,
      );
    }

    // Try synchronous fast-path candidate find
    console.log("[matcher] attempting synchronous findCandidate for", matchId);
    const proId = await findCandidate(body);

    if (proId) {
      console.log(
        "[matcher] immediate candidate found for",
        matchId,
        "proId:",
        proId,
      );
      if (redis) {
        try {
          await redis.hSet(`match:${matchId}`, { status: "found", proId });
          await redis.expire(`match:${matchId}`, ttlSeconds);
          console.log(
            "[matcher] redis: set found & expire for",
            `match:${matchId}`,
            ttlSeconds,
          );
        } catch (e) {
          console.warn("[matcher] redis set found failed:", e?.message || e);
        }
      } else {
        const existing = getLocalMatch(matchId) || {};
        setLocalMatch(
          matchId,
          { ...existing, status: "found", proId },
          ttlSeconds,
        );
        console.log("[matcher] local: set found for", matchId);
      }
      return res.json({ ok: true, found: true, proId, matchId });
    }

    // No immediate candidate — return matchId for polling.
    console.log(
      "[matcher] no immediate candidate for",
      matchId,
      "- polling enabled (ttlSeconds:",
      ttlSeconds,
      ")",
    );
    return res.json({ ok: true, found: false, matchId });
  } catch (err) {
    console.error("[matcher] request error:", err?.stack || err);
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private",
    );
    return res.status(500).json({ error: "matcher_error" });
  }
});

// GET /api/match/:id/status
router.get("/match/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    let data = {};

    console.log("[matcher] status request for", id);

    if (redis) {
      try {
        data = await redis.hGetAll(`match:${id}`);
        // redis returns {} when no hash
      } catch (e) {
        console.warn("[matcher] redis.hGetAll failed:", e?.message || e);
        data = {};
      }
      if (!data || Object.keys(data).length === 0) {
        console.log("[matcher] redis: no record for", `match:${id}`);
        return res.status(404).json({ error: "not_found" });
      }
    } else {
      const local = getLocalMatch(id);
      if (!local) {
        console.log("[matcher] local: no record for", id);
        return res.status(404).json({ error: "not_found" });
      }
      data = local;
    }

    const out = { status: data.status || "searching" };
    if (data.proId) out.proId = data.proId;
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private",
    );
    return res.json(out);
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
        console.log("[matcher] redis: deleted match:", `match:${id}`);
      } catch (e) {
        console.warn("[matcher] redis.del failed:", e?.message || e);
      }
    } else {
      delLocalMatch(id);
      console.log("[matcher] local: deleted match:", id);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[matcher] cancel error:", err);
    return res.status(500).json({ error: "matcher_cancel_failed" });
  }
});

export default router;
