// Optional ETA helper (distance → ETA). Minimal implementation using haversine.
export function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const dLat = deg2rad(bLat - aLat);
  const dLon = deg2rad(bLon - aLon);
  const lat1 = deg2rad(aLat);
  const lat2 = deg2rad(bLat);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function deg2rad(d){ return d * (Math.PI/180); }

// simple estimate: assume avg speed 30 km/h in city (0.5 km/min)
export function estimateEtaMinutes(distanceKm) {
  if (!Number.isFinite(distanceKm)) return null;
  const speedKmph = 30;
  return Math.max(1, Math.round((distanceKm / speedKmph) * 60));
}
