// apps/web/src/lib/api.js
import axios from "axios";

/* =========================================
   AXIOS INSTANCE
   ========================================= */

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8080",
});

// Attach Firebase ID token if stored
api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch {
    // ignore
  }
  return config;
});

export function setAuthToken(token) {
  if (!token) {
    localStorage.removeItem("token");
  } else {
    localStorage.setItem("token", token);
  }
}

/* =========================================
   BASIC / COMMON
   ========================================= */
export async function getMe() {
  const { data } = await api.get("/api/me");
  return data;
}

/* =========================================
   NIGERIA GEO
   ========================================= */
export async function getNgGeo() {
  const { data } = await api.get("/api/geo/ng");
  return data;
}
export async function getNgStates() {
  const { data } = await api.get("/api/geo/ng/states");
  return data;
}
export async function getNgLgas(stateName) {
  const { data } = await api.get(`/api/geo/ng/lgas/${encodeURIComponent(stateName)}`);
  return data;
}

/* =========================================
   BROWSE: PROS (legacy "barbers" naming)
   ========================================= */
export async function listBarbers(params = {}) {
  const { data } = await api.get("/api/barbers", { params });
  return data;
}
export async function getBarber(id) {
  const { data } = await api.get(`/api/barbers/${id}`);
  return data;
}

/* =========================================
   PAYMENTS (Paystack)
   ========================================= */
export async function verifyPayment({ bookingId, reference }) {
  const { data } = await api.post("/api/payments/verify", { bookingId, reference });
  return data; // { ok, status }
}

/* =========================================
   BOOKINGS — CLIENT
   ========================================= */
export async function createBooking(payload) {
  // legacy scheduled booking
  const { data } = await api.post("/api/bookings", payload);
  return data.booking;
}

export async function createInstantBooking(payload) {
  // new instant booking
  const { data } = await api.post("/api/bookings/instant", payload);
  return data;
}

export async function setBookingReference(bookingId, paystackReference) {
  const { data } = await api.put(`/api/bookings/${bookingId}/reference`, { paystackReference });
  return data.ok === true;
}

export async function getMyBookings() {
  const { data } = await api.get("/api/bookings/me");
  return data;
}

export async function cancelBooking(id) {
  const { data } = await api.put(`/api/bookings/${id}/cancel`);
  return data.booking;
}

/* =========================================
   BOOKINGS — PRO OWNER
   ========================================= */
export async function getProBookings() {
  const { data } = await api.get("/api/bookings/pro/me");
  return data;
}
export async function acceptBooking(id) {
  const { data } = await api.put(`/api/bookings/${id}/accept`);
  return data.booking;
}
export async function completeBooking(id) {
  const { data } = await api.put(`/api/bookings/${id}/complete`);
  return data.booking;
}

/* =========================================
   WALLET (optional — align with your server)
   ========================================= */
export async function getMyWallet() {
  const { data } = await api.get("/api/wallets/me");
  return data;
}
export async function getMyTransactions() {
  const { data } = await api.get("/api/transactions/me");
  return data;
}

/* =========================================
   PIN (Wallet PIN on Application)
   ========================================= */
export async function setWithdrawPin(pin) {
  const { data } = await api.post("/api/pin/me/set", { pin });
  return data;
}
export async function resetWithdrawPin(currentPin, newPin) {
  const { data } = await api.put("/api/pin/me/reset", { currentPin, newPin });
  return data;
}

/* =========================================
   SETTINGS
   ========================================= */
export async function getSettings() {
  const { data } = await api.get("/api/settings");
  return data;
}
export async function getAdminSettings() {
  const { data } = await api.get("/api/settings/admin");
  return data;
}
export async function updateSettings(payload) {
  const { data } = await api.put("/api/settings", payload);
  return data;
}

/* =========================================
   PROFILES
   ========================================= */
export async function getClientProfile() {
  const { data } = await api.get("/api/profile/client/me");
  return data;
}
export async function updateClientProfile(payload) {
  const { data } = await api.put("/api/profile/client/me", payload);
  return data;
}
export async function getClientProfileForBooking(clientUid, bookingId) {
  const { data } = await api.get(`/api/profile/client/${clientUid}/for-booking/${encodeURIComponent(bookingId)}`);
  return data;
}
export async function getClientProfileAdmin(clientUid) {
  const { data } = await api.get(`/api/profile/client/${clientUid}/admin`);
  return data;
}
export async function getProProfileMe() {
  const { data } = await api.get("/api/profile/pro/me");
  return data;
}
export async function updateProProfile(payload) {
  const { data } = await api.put("/api/profile/pro/me", payload);
  return data;
}
export async function getPublicProProfile(proId) {
  const { data } = await api.get(`/api/profile/pro/${proId}`);
  return data;
}
export async function getProProfileAdmin(proId) {
  const { data } = await api.get(`/api/profile/pro/${proId}/admin`);
  return data;
}
