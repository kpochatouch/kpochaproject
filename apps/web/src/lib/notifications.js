// apps/web/src/lib/notifications.js
import { api } from "./api";

/**
 * Fetch notifications.
 * - unreadOnly: if true, only unread ones (backend should respect this flag if implemented)
 * - limit: max number to return
 */
export async function fetchNotifications({
  unreadOnly = false,
  limit = 30,
} = {}) {
  const params = {};
  if (limit) params.limit = limit;
  if (unreadOnly) params.unreadOnly = true;

  const { data } = await api.get("/api/notifications", { params });

  // backend may return an array or { items: [] }
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

/**
 * Mark a single notification as read/seen.
 * (uses the new canonical endpoint)
 */
export async function markNotificationSeen(id) {
  if (!id) throw new Error("notification id required");
  const { data } = await api.put(
    `/api/notifications/${encodeURIComponent(id)}/read`,
  );
  return data;
}

/**
 * Mark all notifications as read.
 */
export async function markAllSeen() {
  const { data } = await api.put("/api/notifications/read-all");
  return data;
}
