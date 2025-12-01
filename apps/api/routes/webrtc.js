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

router.get("/webrtc/ice", (req, res) => {
  try {
    const stun = parseList(process.env.ICE_STUN_URLS || "");
    const turnUrls = parseList(process.env.ICE_TURN_URLS || "");
    const turnUsername = process.env.ICE_TURN_USERNAME || "";
    const turnPassword = process.env.ICE_TURN_PASSWORD || "";

    const iceServers = [];

    if (stun.length) iceServers.push({ urls: stun });

    if (turnUrls.length) {
      if (turnUsername && turnPassword) {
        iceServers.push({
          urls: turnUrls,
          username: turnUsername,
          credential: turnPassword,
        });
      } else {
        iceServers.push({ urls: turnUrls });
      }
    }

    if (iceServers.length === 0) {
      iceServers.push({
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302",
        ],
      });
    }

    return res.json({ iceServers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "ice_failed" });
  }
});

export default router;
