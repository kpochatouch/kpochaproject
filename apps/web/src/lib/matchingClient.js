// apps/web/src/lib/matchingClient.js
import { api } from "./api";

/**
 * matchingClient - safe wrapper around /api/match endpoints
 * Always returns {} on unexpected errors to avoid UI crashes.
 */
export default {
  async requestMatch({ serviceName, lat, lon, state, lga } = {}) {
    try {
      const payload = {};

      // Only include serviceName when present (service-mode)
      if (serviceName) payload.serviceName = serviceName;

      if (typeof lat === "number") payload.lat = lat;
      if (typeof lon === "number") payload.lon = lon;
      if (state) payload.state = state;
      if (lga) payload.lga = lga;

      const { data } = await api.post("/api/match/request", payload);
      return data || {};
    } catch (e) {
      console.warn(
        "[matchingClient] requestMatch error:",
        e?.response?.data || e?.message || e,
      );
      return {}; // important fallback
    }
  },

  async getStatus(matchId) {
    if (!matchId) return {};
    try {
      const { data } = await api.get(
        `/api/match/${encodeURIComponent(matchId)}/status`,
      );
      return data || {};
    } catch (e) {
      // we MUST rethrow for InstantRequest polling logic
      console.warn(
        "[matchingClient] getStatus error:",
        e?.response?.data || e?.message || e,
      );
      throw e;
    }
  },

  async cancel(matchId) {
    if (!matchId) return {};
    try {
      const { data } = await api.post(
        `/api/match/${encodeURIComponent(matchId)}/cancel`,
      );
      return data || {};
    } catch (e) {
      console.warn(
        "[matchingClient] cancel error:",
        e?.response?.data || e?.message || e,
      );
      return {};
    }
  },
};
