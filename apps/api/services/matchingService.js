// apps/api/services/matchingService.js
import { Pro } from "../models.js";
import redis from "../redis.js";

// Basic candidate selection:
//  - first try geospatial query against Pro.loc (if coordinates provided)
//  - fallback to LGA/state match
//  - score by availability and services (very simple)
//
// This function returns pro._id (string) or null.
export async function findCandidate({ lat, lon, state = "", lga = "", serviceName = "" } = {}) {
  try {
    // If lat/lon provided, try geo query (requires loc field on Pro)
    if (lat !== undefined && lon !== undefined && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
      try {
        // Attempt $geoNear aggregation first (works when index exists)
        const nearby = await Pro.aggregate([
          {
            $geoNear: {
              near: { type: "Point", coordinates: [Number(lon), Number(lat)] },
              distanceField: "dist",
              spherical: true,
              maxDistance: 25 * 1000, // 25 km cap
              key: "loc",
            },
          },
          { $limit: 50 },
        ]);
        if (Array.isArray(nearby) && nearby.length) {
          for (const p of nearby) {
            if (serviceName) {
              const has = Array.isArray(p.services) && p.services.some(s => String(s).toLowerCase().includes(String(serviceName).toLowerCase()));
              if (!has) continue;
            }
            if (p.status && p.status !== "approved") continue;
            return String(p._id);
          }
        }
      } catch (e) {
        // log the error so we know why geo failed (missing index, bad field, etc.)
        console.warn("[matchingService] geoNear failed — will fallback to $near or LGA/state. Error:", e?.message || e);
        // try a safer $near query (this also requires a 2dsphere index but sometimes behaves differently)
        try {
          const nearDocs = await Pro.find({
            loc: {
              $nearSphere: {
                $geometry: { type: "Point", coordinates: [Number(lon), Number(lat)] },
                $maxDistance: 25 * 1000,
              },
            },
          }).limit(50).lean();
          if (nearDocs && nearDocs.length) {
            for (const p of nearDocs) {
              if (serviceName) {
                const has = Array.isArray(p.services) && p.services.some(s => String(s).toLowerCase().includes(String(serviceName).toLowerCase()));
                if (!has) continue;
              }
              if (p.status && p.status !== "approved") continue;
              return String(p._id);
            }
          }
        } catch (e2) {
          console.warn("[matchingService] $nearSphere also failed:", e2?.message || e2);
          // fall through to LGA/state fallback below
        }
      }
    }

    // fallback: try LGA first then state
    const q = {};
    if (lga) q.lga = new RegExp(`^${escapeRegex(String(lga))}$`, "i");
    else if (state) q.state = new RegExp(`^${escapeRegex(String(state))}$`, "i");

    if (serviceName) {
      q.$or = [
        { services: { $elemMatch: { $regex: new RegExp(escapeRegex(String(serviceName)), "i") } } },
        { "servicesDetailed.name": { $regex: new RegExp(escapeRegex(String(serviceName)), "i") } },
      ];
    }

    const docs = await Pro.find(q).limit(50).lean();
    for (const p of docs) {
      if (p.status && p.status !== "approved") continue;
      return String(p._1 || p._id); // return whichever is present
    }

    return null;
  } catch (err) {
    console.error("[matchingService] error:", err?.stack || err);
    return null;
  }
}

function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
