import { api } from "./api";

export default {
  async requestMatch(payload = {}) {
    const { data } = await api.post("/api/match/request", payload);
    return data || {};
  },
  async getStatus(matchId) {
    const { data } = await api.get(`/api/match/${encodeURIComponent(matchId)}/status`);
    return data || {};
  },
  async cancel(matchId) {
    const { data } = await api.post(`/api/match/${encodeURIComponent(matchId)}/cancel`);
    return data || {};
  },
};
