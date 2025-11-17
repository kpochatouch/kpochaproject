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
        for (const p of nearby) {
          if (serviceName) {
            const has = Array.isArray(p.services) && p.services.some(s => String(s).toLowerCase().includes(String(serviceName).toLowerCase()));
            if (!has) continue;
          }
          // very simple availability check: skip if status not approved
          if (p.status && p.status !== "approved") continue;
          return String(p._id);
        }
      } catch (e) {
        // geo query may fail if no loc; fall through to LGA/state
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
      return String(p._id);
    }

    return null;
  } catch (err) {
    console.error("[matchingService] error:", err);
    return null;
  }
}

function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
