// apps/web/src/lib/api.js
import axios from "axios";
import { getAuth, onAuthStateChanged } from "firebase/auth";

/* =========================================
   BASE URL
   ========================================= */
let RAW = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
if (RAW.endsWith("/api")) RAW = RAW.slice(0, -4);
const ROOT = RAW.replace(/\/+$/, "");

export const api = axios.create({
  baseURL: ROOT || undefined,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
});

/* =========================================
   AUTH TOKEN (no loops, no forced refresh)
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

// Attach Firebase ID token if available (no force refresh)
api.interceptors.request.use(async (config) => {
  await authReady;
  try {
    const auth = getAuth();
    const user = auth?.currentUser || null;
    if (user) {
      const idToken = await user.getIdToken(); // <-- no "true"
      if (idToken) config.headers.Authorization = `Bearer ${idToken}`;
    } else {
      delete config.headers.Authorization;
    }
  } catch {
    // fall back to any stored token (optional)
    try {
      const token = localStorage.getItem("token");
      if (token) config.headers.Authorization = `Bearer ${token}`;
    } catch {}
  }
  return config;
});

/* =========================================
   LIGHTWEIGHT CACHE for GET /api/me (60s)
   ========================================= */
const ME_TTL_MS = 60_000;
let meCache = { ts: 0, data: null };

// Helper to check if this request is for /api/me
function isMeEndpoint(cfg) {
  const base = (cfg.baseURL || "").replace(/\/+$/, "");
  const url = (cfg.url || "").replace(/^\/+/, "");
  const full = `${base}/${url}`;
  return /\/api\/me(?:[?#]|$)/.test(full);
}

// Serve cached /api/me response when fresh
api.interceptors.request.use((config) => {
  if ((config.method || "get").toLowerCase() === "get" && isMeEndpoint(config) && !config.__bypassCache) {
    const now = Date.now();
    if (meCache.data && now - meCache.ts < ME_TTL_MS) {
      // Use a custom adapter to return a resolved cached response
      const cached = meCache.data;
      config.adapter = async () => ({
        data: cached,
        status: 200,
        statusText: "OK (cache)",
        headers: { "x-cache": "me-60s" },
        config,
      });
    } else {
      // Mark so we store fresh response below
      config.__cacheMe = true;
    }
  }
  return config;
});

// Store fresh /api/me responses in cache
api.interceptors.response.use(
  (r) => {
    try {
      if (r?.config && isMeEndpoint(r.config)) {
        meCache = { ts: Date.now(), data: r.data };
      }
    } catch {}
    return r;
  },
  async (err) => {
    // If no response (network/CORS), map a friendly message and exit
    if (!err?.response) {
      err.friendlyMessage = navigator.onLine
        ? "Cannot reach the server. It might be offline or blocked by CORS."
        : "You appear to be offline. Please check your connection.";
      return Promise.reject(err);
    }

    const { status, data, config } = err.response;

    // One-time 401 retry with forced refresh
    if (status === 401 && config && !config.__retried) {
      try {
        const auth = getAuth();
        const u = auth.currentUser;
        if (u) {
          await u.getIdToken(true); // force refresh once
          const fresh = await u.getIdToken();
          if (fresh) {
            config.headers = { ...(config.headers || {}), Authorization: `Bearer ${fresh}` };
            config.__retried = true;
            return api(config);
          }
        } else {
          if (config.headers) delete config.headers.Authorization;
        }
      } catch {
        // fall through to friendly message
      }
    }

    /* =========================================
       FRIENDLY ERROR MESSAGES
       ========================================= */
    const serverMsg =
      data?.message ||
      data?.error ||
      (typeof data === "string" ? data : "") ||
      "";

    let msg = serverMsg;
    switch (status) {
      case 400:
        msg = serverMsg || "Invalid data. Please review the highlighted fields.";
        break;
      case 401:
        msg = "Your session has expired. Please sign in again.";
        break;
      case 403:
        msg = "You don’t have permission to do this.";
        break;
      case 404:
        msg = serverMsg || "Not found.";
        break;
      case 413:
        msg = "One of the files is too large (max 5MB).";
        break;
      case 422:
        if (data?.errors && typeof data.errors === "object") {
          const details = Object.entries(data.errors)
            .map(([k, v]) => `${k}: ${v}`)
            .join("; ");
          msg = `Please fix: ${details}`;
        } else {
          msg = serverMsg || "Some fields are invalid.";
        }
        break;
      case 429:
        msg = "Too many attempts. Please try again in a moment.";
        break;
      case 500:
        msg = serverMsg || "Server error. Please try again shortly.";
        break;
      case 503:
        msg =
          serverMsg ||
          "Service temporarily unavailable. Please try again in a moment.";
        break;
      default:
        msg = serverMsg || `Request failed (${status}).`;
    }

    err.friendlyMessage = msg;
    err.debugPayload = data;
    return Promise.reject(err);
  }
);

/* =========================================
   HELPERS
   ========================================= */
export function setAuthToken(token) {
  if (!token) localStorage.removeItem("token");
  else localStorage.setItem("token", token);
}

/* =========================================
   BASIC / COMMON
   ========================================= */
export async function getMe({ fresh = false } = {}) {
  // If a screen really needs a fresh copy right now, pass { fresh: true }
  const { data } = await api.get("/api/me", fresh ? { __bypassCache: true } : undefined);
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
  const { data } = await api.get(`/api/barbers/nearby`, { params: { lat, lon, radiusKm } });
  return data;
}

/* =========================================
   FEED
   ========================================= */
export async function listPublicFeed(params = {}) {
  const { data } = await api.get("/api/feed/public", { params });
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
  const { data } = await api.post("/api/payments/verify", { bookingId, reference });
  return data;
}
export async function initPayment({ bookingId, amountKobo, email }) {
  const { data } = await api.post("/api/payments/init", { bookingId, amountKobo, email });
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
  const { data } = await api.put(`/api/bookings/${id}/decline`, payload);
  return data.booking;
}
export async function completeBooking(id) {
  const { data } = await api.put(`/api/bookings/${id}/complete`);
  return data.booking;
}

/* =========================================
   WALLET
   ========================================= */
export async function getWalletMe() {
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

/* =========================================
   PIN
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
  const { data } = await api.get(
    `/api/profile/client/${clientUid}/for-booking/${encodeURIComponent(bookingId)}`
  );
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

/* =========================================
   POSTS
   ========================================= */
export async function likePost(id) {
  const { data } = await api.post(`/api/posts/${id}/like`);
  return data;
}
export async function addPostComment(id, text) {
  const { data } = await api.post(`/api/posts/${id}/comments`, { text });
  return data;
}
export async function listPostComments(id) {
  const { data } = await api.get(`/api/posts/${id}/comments`);
  return data;
}
export async function pingPostView(id) {
  const { data } = await api.post(`/api/posts/${id}/view`);
  return data;
}
