// apps/web/src/lib/matchingClient.js
import { api } from "./api";

/**
 * matchingClient - thin wrapper around /api/match endpoints
 * returns {} on unexpected errors so frontend logic stays simple.
 */
export default {
  async requestMatch(payload = {}) {
    try {
      const { data } = await api.post("/api/match/request", payload);
      return data || {};
    } catch (e) {
      console.warn("[matchingClient] requestMatch error:", e?.response?.data || e?.message || e);
      return {};
    }
  },

  async getStatus(matchId) {
    if (!matchId) return {};
    try {
      const { data } = await api.get(`/api/match/${encodeURIComponent(matchId)}/status`);
      return data || {};
    } catch (e) {
      // rethrow axios error so caller can check e.response.status (404 => expired)
      console.warn("[matchingClient] getStatus error:", e?.response?.data || e?.message || e);
      throw e;
    }
  },

  async cancel(matchId) {
    if (!matchId) return {};
    try {
      const { data } = await api.post(`/api/match/${encodeURIComponent(matchId)}/cancel`);
      return data || {};
    } catch (e) {
      console.warn("[matchingClient] cancel error:", e?.response?.data || e?.message || e);
      return {};
    }
  },
};
