import { api } from "./api";

// A card can be rendered more than once during a feed transition. Coalescing
// simultaneous ticks prevents duplicate client requests for the same post.
const inFlightViewRequests = new Map();

export async function fetchPostStats(postId) {
  const { data } = await api.get(
    `/api/posts/${encodeURIComponent(postId)}/stats`,
  );
  return data || {};
}

export function recordPostView(postId) {
  const key = String(postId || "");
  if (!key) return Promise.reject(new Error("post_id_required"));

  const existing = inFlightViewRequests.get(key);
  if (existing) return existing;

  const request = api
    .post(`/api/posts/${encodeURIComponent(key)}/view`)
    .then((response) => response?.data || {})
    .finally(() => inFlightViewRequests.delete(key));

  inFlightViewRequests.set(key, request);
  return request;
}
