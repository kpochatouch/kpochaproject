// apps/web/src/lib/api.js
import axios from "axios";
import { getAuth, onAuthStateChanged } from "firebase/auth";

/* =========================================
   BASE URL (normalize, no trailing slash, no /api suffix)
   ========================================= */
let ROOT =
  (import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_BASE ||
    "")
    .toString()
    .trim();

if (!ROOT) {
  ROOT = "http://localhost:8080";
}
ROOT = ROOT.replace(/\/+$/, "");
if (/\/api$/i.test(ROOT)) ROOT = ROOT.replace(/\/api$/i, "");

// Points to server root. Your paths below already start with "/api/...".
export const api = axios.create({
  baseURL: ROOT,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

/* =========================================
   AUTH TOKEN (Firebase preferred, localStorage fallback)
   ========================================= */
let authReady = new Promise((resolve) => {
  try {
    const auth = getAuth();
    const stop = onAuthStateChanged(auth, () => {
      stop();
      resolve();
    });
  } catch {
    resolve();
  }
});

api.interceptors.request.use(async (config) => {
  await authReady;

  // Try Firebase ID token first
  try {
    const auth = getAuth();
    const user = auth?.currentUser || null;
    if (user) {
      const idToken = await user.getIdToken();
      if (idToken) config.headers.Authorization = `Bearer ${idToken}`;
      return config;
    }
  } catch {}

  // Fallback to localStorage token (for admin tools)
  try {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch {}

  return config;
});

export function setAuthToken(token) {
  if (!token) localStorage.removeItem("token");
  else localStorage.setItem("token", token);
}

/* small helper to drop empties */
function stripEmpty(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === null || typeof v === "undefined") continue;
    // also drop NaN
    if (typeof v === "number" && Number.isNaN(v)) continue;
    out[k] = v;
  }
  return out;
}

/* =========================================
   BASIC / COMMON
   ========================================= */
export async function getMe() {
  const { data } = await api.get("/api/me");
  return data;
}

/**
 * Pro self – we are adding this now so we can bundle me+client+pro
 */
export async function getProMe() {
  try {
    const { data } = await api.get("/api/pros/me");
    return data;
  } catch (e) {
    // not a pro yet → return null instead of throwing
    return null;
  }
}

/**
 * Unified bundle:
 * - /api/me → firebase uid + email
 * - /api/profile/me → client profile (SOURCE OF TRUTH)
 * - /api/pros/me → pro doc (if exists)
 */
export async function loadMeBundle() {
  const [meRes, clientRes, proRes] = await Promise.allSettled([
    getMe(),
    getClientProfile(),
    getProMe(),
  ]);

  const me = meRes.status === "fulfilled" ? meRes.value : null;
  const client = clientRes.status === "fulfilled" ? clientRes.value : null;
  const pro = proRes.status === "fulfilled" ? proRes.value : null;

  return { me, client, pro };
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
  const { data } = await api.get(
    `/api/geo/ng/lgas/${encodeURIComponent(stateName)}`
  );
  return data;
}
export async function reverseGeocode({ lat, lon }) {
  const { data } = await api.get("/api/geo/rev", {
    params: { lat, lon },
  });
  return data;
}

/* =========================================
   BROWSE: PROS
   ========================================= */
export async function listBarbers(params = {}) {
  const { data } = await api.get("/api/barbers", { params });
  return data;
}
export async function getBarber(id) {
  const { data } = await api.get(`/api/barbers/${id}`);
  return data;
}
export async function listNearbyBarbers({ lat, lon, radiusKm = 25 }) {
  const { data } = await api.get(`/api/barbers/nearby`, {
    params: { lat, lon, radiusKm },
  });
  return data;
}

/* =========================================
   FEED
   ========================================= */
export async function listPublicFeed(params = {}) {
  const { data } = await api.get("/api/posts/public", { params });
  return data;
}
export async function createPost(payload) {
  const { data } = await api.post("/api/posts", payload);
  return data;
}

/* =========================================
   PAYMENTS (Paystack)
   ========================================= */
export async function verifyPayment({ bookingId, reference }) {
  const { data } = await api.post("/api/payments/verify", {
    bookingId,
    reference,
  });
  return data;
}
export async function initPayment({ bookingId, amountKobo, email }) {
  const { data } = await api.post("/api/payments/init", {
    bookingId,
    amountKobo,
    email,
  });
  return data;
}

/* =========================================
   BOOKINGS — CLIENT
   ========================================= */
export async function createBooking(payload) {
  const { data } = await api.post("/api/bookings", payload);
  return data.booking;
}
export async function createInstantBooking(payload) {
  const { data } = await api.post("/api/bookings/instant", payload);
  return data;
}
export async function setBookingReference(bookingId, paystackReference) {
  const { data } = await api.put(
    `/api/bookings/${bookingId}/reference`,
    { paystackReference }
  );
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
export async function declineBooking(id, payload = {}) {
  const { data } = await api.put(
    `/api/bookings/${id}/decline`,
    payload
  );
  return data.booking;
}
export async function completeBooking(id) {
  const { data } = await api.put(`/api/bookings/${id}/complete`);
  return data.booking;
}

/* =========================================
   WALLET (client + pro)
   ========================================= */
export async function getWalletMe() {
  const { data } = await api.get("/api/wallet/me");
  return data;
}
export async function initWalletTopup(amountKobo) {
  const { data } = await api.post("/api/wallet/topup/init", {
    amountKobo,
  });
  return data;
}
export async function verifyWalletTopup(reference) {
  const { data } = await api.post("/api/wallet/topup/verify", {
    reference,
  });
  return data;
}
export async function withdrawPendingToAvailable({ amountKobo, pin }) {
  const { data } = await api.post("/api/wallet/withdraw-pending", {
    amountKobo,
    pin,
  });
  return data;
}
export async function withdrawToBank({ amountKobo, pin }) {
  const { data } = await api.post("/api/wallet/withdraw", {
    amountKobo,
    pin,
  });
  return data;
}
export const getMyWallet = getWalletMe;
export async function getMyTransactions() {
  const data = await getWalletMe();
  return data?.transactions || [];
}

/* Client wallet (credits/refunds) */
export async function getClientWalletMe() {
  const { data } = await api.get("/api/wallet/client/me");
  return data;
}

/* =========================================
   PIN
   ========================================= */
export async function setWithdrawPin(pin) {
  const { data } = await api.post("/api/pin/me/set", { pin });
  return data;
}
export async function resetWithdrawPin(currentPin, newPin) {
  const { data } = await api.put("/api/pin/me/reset", {
    currentPin,
    newPin,
  });
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
   PRO APPLICATIONS / PROFILES
   ========================================= */
export async function submitProApplication(payload) {
  const { data } = await api.post("/api/applications", payload);
  return data;
}

/* Unified Client Profile (one UID per user) */
export async function getClientProfile() {
  const { data } = await api.get("/api/profile/me"); // unified alias
  return data;
}
export async function updateClientProfile(payload) {
  // 🔴 strip empties so backend doesn't reject
  const clean = stripEmpty(payload);
  const { data } = await api.put("/api/profile/me", clean);
  return data;
}

// alias for the new flow name I used in Settings.jsx
export const saveClientProfile = updateClientProfile;

/* Optional booking/admin helpers */
export async function getClientProfileForBooking(clientUid, bookingId) {
  const { data } = await api.get(
    `/api/profile/client/${clientUid}/for-booking/${encodeURIComponent(
      bookingId
    )}`
  );
  return data;
}
export async function getClientProfileAdmin(clientUid) {
  const { data } = await api.get(
    `/api/profile/client/${clientUid}/admin`
  );
  return data;
}

/* Pro extras (gallery, bio, whatsapp, shop – NOT name/phone/lga) */
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
