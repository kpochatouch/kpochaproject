// apps/web/src/lib/notifications.js
import { api } from "./api";

export async function fetchNotifications({ unreadOnly = false, limit = 30 } = {}) {
  const { data } = await api.get("/api/notifications", { params: { unreadOnly, limit } });
  return data || [];
}

export async function markNotificationSeen(id) {
  const { data } = await api.post(`/api/notifications/${encodeURIComponent(id)}/seen`);
  return data;
}

export async function markAllSeen() {
  const { data } = await api.post("/api/notifications/mark-all-seen");
  return data;
}
