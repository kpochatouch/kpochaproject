// apps/api/routes/webrtc.js
import express from "express";
const router = express.Router();

function parseList(envVar) {
  if (!envVar) return [];
  return String(envVar)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * GET /api/webrtc/ice
 * Returns an iceServers array to be used by RTCPeerConnection.
 *
 * Priority:
 * 1) ICE_STUN_URLS from env (comma separated)
 * 2) ICE_TURN_URLS + ICE_TURN_USERNAME + ICE_TURN_PASSWORD from env
 * 3) Fallback to Google STUN (safe, no credentials) — only if no other ICE configured
 *
 * NOTE: TURN credentials must only be stored on the server env (Render).
 */
router.get("/ice", (req, res) => {
  try {
    const stun = parseList(process.env.ICE_STUN_URLS || "");
    const turnUrls = parseList(process.env.ICE_TURN_URLS || "");
    const turnUsername = process.env.ICE_TURN_USERNAME || "";
    const turnPassword = process.env.ICE_TURN_PASSWORD || "";

    const iceServers = [];

    // 1) Add STUN urls if present
    if (stun.length) {
      iceServers.push({ urls: stun });
    }

    // 2) Add TURN entry if present and credentials supplied
    if (turnUrls.length) {
      if (turnUsername && turnPassword) {
        iceServers.push({
          urls: turnUrls,
          username: turnUsername,
          credential: turnPassword,
        });
      } else {
        // Return turn urls even without credentials — edge cases only.
        iceServers.push({ urls: turnUrls });
      }
    }

    // 3) If nothing configured, fallback to Google STUN to avoid silent failures
    if (iceServers.length === 0) {
      iceServers.push({
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302",
        ],
      });
      // We can also return a warning message if you prefer:
      // return res.status(500).json({ error: 'no_ice_configured', message: 'No ICE configured on server' });
    }

    // Small cache header — ICE rarely changes
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    return res.json({ iceServers });
  } catch (err) {
    console.error("[webrtc/ice] unexpected error:", err?.message || err);
    return res.status(500).json({ error: "ice_failed" });
  }
});

export default router;
