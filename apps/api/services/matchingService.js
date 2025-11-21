// apps/api/services/matchingService.js
import { Pro } from "../models.js";
import redis from "../redis.js"; // (not used yet but kept for future use)

// helper: safely escape regex special chars
function escapeRegex(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// helper: does this pro offer the requested service?
function proHasService(p = {}, serviceName = "") {
  if (!serviceName) return true;
  const needle = String(serviceName).toLowerCase();

  // 1) top-level services as strings
  const fromStringServices =
    Array.isArray(p.services) &&
    p.services.some(
      (s) =>
        typeof s === "string" &&
        s.toLowerCase().includes(needle)
    );

  // 2) top-level services as objects: [{ name, price, ... }]
  const fromObjectServices =
    Array.isArray(p.services) &&
    p.services.some((s) => {
      if (!s || typeof s !== "object") return false;
      const name = String(s.name || s.id || "").toLowerCase();
      return name.includes(needle);
    });

  // 3) servicesDetailed
  const fromDetailed =
    Array.isArray(p.servicesDetailed) &&
    p.servicesDetailed.some((s) =>
      String(s?.name || "").toLowerCase().includes(needle)
    );

  // 4) professional.services (always strings)
  const fromProfessional =
    p.professional &&
    Array.isArray(p.professional.services) &&
    p.professional.services.some((s) =>
      String(s || "").toLowerCase().includes(needle)
    );

  return (
    fromStringServices ||
    fromObjectServices ||
    fromDetailed ||
    fromProfessional
  );
}

// Basic candidate selection:
//  - first try geospatial query against Pro.loc (if coordinates provided)
//  - fallback to LGA/state match
//  - score by availability and services (very simple)
//
// This function returns pro._id (string) or null.
export async function findCandidate({
  lat,
  lon,
  state = "",
  lga = "",
  serviceName = "",
} = {}) {
  try {
    /* ---------- 1) GEO NEAR if coords exist ---------- */
    if (
      lat !== undefined &&
      lon !== undefined &&
      Number.isFinite(Number(lat)) &&
      Number.isFinite(Number(lon))
    ) {
      try {
        const nearby = await Pro.aggregate([
          {
            $geoNear: {
              near: {
                type: "Point",
                coordinates: [Number(lon), Number(lat)],
              },
              distanceField: "dist",
              spherical: true,
              maxDistance: 25 * 1000, // 25 km
              key: "loc",
            },
          },
          { $limit: 50 },
        ]);

        if (Array.isArray(nearby) && nearby.length) {
          for (const p of nearby) {
            if (p.status && p.status !== "approved") continue;
            if (!proHasService(p, serviceName)) continue;
            return String(p._id);
          }
        }
      } catch (e) {
        console.warn(
          "[matchingService] geoNear failed — will fallback to $nearSphere / LGA. Error:",
          e?.message || e
        );
        // optional nearSphere fallback
        try {
          const nearDocs = await Pro.find({
            loc: {
              $nearSphere: {
                $geometry: {
                  type: "Point",
                  coordinates: [Number(lon), Number(lat)],
                },
                $maxDistance: 25 * 1000,
              },
            },
          })
            .limit(50)
            .lean();

          if (nearDocs && nearDocs.length) {
            for (const p of nearDocs) {
              if (p.status && p.status !== "approved") continue;
              if (!proHasService(p, serviceName)) continue;
              return String(p._id);
            }
          }
        } catch (e2) {
          console.warn(
            "[matchingService] $nearSphere also failed:",
            e2?.message || e2
          );
          // fall through to LGA/state fallback
        }
      }
    }

    /* ---------- 2) Fallback by LGA / state + service ---------- */
    const q = {};

    if (lga) {
      q.lga = new RegExp(`^${escapeRegex(String(lga))}$`, "i");
    } else if (state) {
      q.state = new RegExp(`^${escapeRegex(String(state))}$`, "i");
    }

    if (serviceName) {
      const re = new RegExp(escapeRegex(String(serviceName)), "i");
      q.$or = [
        // services as strings
        { services: { $elemMatch: { $regex: re } } },
        // services as objects
        { "services.name": { $regex: re } },
        // servicesDetailed
        { "servicesDetailed.name": { $regex: re } },
        // professional.services
        { "professional.services": { $elemMatch: { $regex: re } } },
      ];
    }

    const docs = await Pro.find(q).limit(50).lean();
    for (const p of docs) {
      if (p.status && p.status !== "approved") continue;
      if (!proHasService(p, serviceName)) continue;
      return String(p._id);
    }

    return null;
  } catch (err) {
    console.error("[matchingService] error:", err?.stack || err);
    return null;
  }
}
