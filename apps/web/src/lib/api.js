// apps/web/src/lib/api.js
import axios from "axios";
import { getAuth } from "firebase/auth";

/* =========================
   API ROOT (no trailing /)
   ========================= */
let ROOT =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  "http://localhost:8080";
ROOT = ROOT.replace(/\/+$/, "");
if (/\/api$/i.test(ROOT)) ROOT = ROOT.replace(/\/api$/i, "");

// All requests below already include "/api/..."
export const api = axios.create({
  baseURL: ROOT,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
});

/* =========================
   AUTH HEADER
   ========================= */
api.interceptors.request.use(async (config) => {
  // Try a fresh ID token from Firebase
  try {
    const auth = getAuth();
    const u = auth.currentUser;
    if (u) {
      // force refresh avoids using an expired cached token
      const t = await u.getIdToken(true);
      if (t) config.headers.Authorization = `Bearer ${t}`;
      return config;
    }
  } catch {}

  // Fallback to localStorage token if present
  try {
    const t = localStorage.getItem("token");
    if (t) config.headers.Authorization = `Bearer ${t}`;
  } catch {}

  return config;
});

export function setAuthToken(token) {
  if (!token) localStorage.removeItem("token");
  else localStorage.setItem("token", token);
}

/* =========================
   BASIC / COMMON
   ========================= */
export async function getMe() {
  const { data } = await api.get("/api/me");
  return data;
}

/* =========================
   GEO
   ========================= */
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
export async function reverseGeocode({ lat, lon }) {
  const { data } = await api.get("/api/geo/rev", { params: { lat, lon } });
  return data;
}

/* =========================
   BROWSE: PROS
   ========================= */
export async function listBarbers(params = {}) {
  const { data } = await api.get("/api/barbers", { params });
  return data;
}
export async function getBarber(id) {
  const { data } = await api.get(`/api/barbers/${id}`);
  return data;
}
export async function listNearbyBarbers({ lat, lon, radiusKm = 25 }) {
  const { data } = await api.get(`/api/barbers/nearby`, { params: { lat, lon, radiusKm } });
  return data;
}

/* =========================
   FEED
   ========================= */
export async function listPublicFeed(params = {}) {
  const { data } = await api.get("/api/feed/public", { params });
  return data;
}
export async function createPost(payload) {
  const { data } = await api.post("/api/posts", payload);
  return data;
}

/* =========================
   PAYMENTS
   ========================= */
export async function verifyPayment({ bookingId, reference }) {
  const { data } = await api.post("/api/payments/verify", { bookingId, reference });
  return data;
}
export async function initPayment({ bookingId, amountKobo, email }) {
  const { data } = await api.post("/api/payments/init", { bookingId, amountKobo, email });
  return data;
}

/* =========================
   BOOKINGS — CLIENT
   ========================= */
export async function createBooking(payload) {
  const { data } = await api.post("/api/bookings", payload);
  return data.booking;
}
export async function createInstantBooking(payload) {
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
export async function getBooking(id) {
  const { data } = await api.get(`/api/bookings/${id}`);
  return data;
}
export async function cancelBooking(id) {
  const { data } = await api.put(`/api/bookings/${id}/cancel`);
  return data.booking;
}

/* =========================
   BOOKINGS — PRO OWNER
   ========================= */
export async function getProBookings() {
  const { data } = await api.get("/api/bookings/pro/me");
  return data;
}
export async function acceptBooking(id) {
  const { data } = await api.put(`/api/bookings/${id}/accept`);
  return data.booking;
}
export async function declineBooking(id, payload = {}) {
  const { data } = await api.put(`/api/bookings/${id}/decline`, payload);
  return data.booking;
}
export async function completeBooking(id) {
  const { data } = await api.put(`/api/bookings/${id}/complete`);
  return data.booking;
}

/* =========================
   WALLET
   ========================= */
export async function getWalletMe() {
  // keep calling /api/wallet/me (server will alias for clients below)
  const { data } = await api.get("/api/wallet/me");
  return data;
}
export async function initWalletTopup(amountKobo) {
  const { data } = await api.post("/api/wallet/topup/init", { amountKobo });
  return data;
}
export async function verifyWalletTopup(reference) {
  const { data } = await api.post("/api/wallet/topup/verify", { reference });
  return data;
}
export async function withdrawPendingToAvailable({ amountKobo, pin }) {
  const { data } = await api.post("/api/wallet/withdraw-pending", { amountKobo, pin });
  return data;
}
export async function withdrawToBank({ amountKobo, pin }) {
  const { data } = await api.post("/api/wallet/withdraw", { amountKobo, pin });
  return data;
}
export const getMyWallet = getWalletMe;
export async function getMyTransactions() {
  const data = await getWalletMe();
  return data?.transactions || [];
}

/* =========================
   PIN
   ========================= */
export async function setWithdrawPin(pin) {
  const { data } = await api.post("/api/pin/me/set", { pin });
  return data;
}
export async function resetWithdrawPin(currentPin, newPin) {
  const { data } = await api.put("/api/pin/me/reset", { currentPin, newPin });
  return data;
}

/* =========================
   SETTINGS
   ========================= */
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

/* =========================
   PRO / CLIENT PROFILES
   ========================= */
export async function submitProApplication(payload) {
  const { data } = await api.post("/api/applications", payload);
  return data;
}

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
