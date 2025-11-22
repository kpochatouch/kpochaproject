// apps/web/src/lib/api.js
import axios from "axios";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import io from "socket.io-client"; 
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
  withCredentials: true, // 👈 allow cookie (anonId) to be sent and received
});


/* =========================================
   AUTH HANDLING
   - we keep listening to Firebase changes
   - we refresh token on each request if possible
   - we still support manual setAuthToken() (your Login.jsx uses it)
   ========================================= */
let firebaseAuth = null;
let authListenerStarted = false;
// latest token we heard from Firebase (or manual setter)
let latestToken = null;

// start a persistent listener so sign-out/sign-in later also updates tokens
function ensureAuthListener() {
  if (authListenerStarted) return;
  authListenerStarted = true;
  try {
    firebaseAuth = getAuth();
    onAuthStateChanged(firebaseAuth, async (user) => {
      if (user) {
        try {
          const t = await user.getIdToken();
          latestToken = t;
          // keep parity with your manual setter
          try {
            localStorage.setItem("token", t);
          } catch {}
        } catch {
          // ignore
        }
      } else {
        latestToken = null;
        try {
          localStorage.removeItem("token");
        } catch {}
      }
    });
  } catch {
    // firebase not available (SSR / build) — we just skip
  }
}
ensureAuthListener();

api.interceptors.request.use(async (config) => {
  // make sure listener is running
  ensureAuthListener();

  // 1) if we have firebase and a current user, ask for a fresh token
  if (firebaseAuth) {
    const user = firebaseAuth.currentUser;
    if (user) {
      try {
        // getIdToken() (no force) will refresh if needed
        const fresh = await user.getIdToken();
        if (fresh) {
          latestToken = fresh;
          config.headers.Authorization = `Bearer ${fresh}`;
          return config;
        }
      } catch {
        // fall through to latestToken/localStorage
      }
    }
  }

  // 2) if we have a token from the listener, use it
  if (latestToken) {
    config.headers.Authorization = `Bearer ${latestToken}`;
    return config;
  }

  // 3) fallback to localStorage token (used by your Login.jsx)
  try {
    const t = localStorage.getItem("token");
    if (t) {
      latestToken = t;
      config.headers.Authorization = `Bearer ${t}`;
    }
  } catch {
    // ignore
  }

  return config;
});

// manual override used in Login.jsx after sign-in
export function setAuthToken(token) {
  if (!token) {
    try {
      localStorage.removeItem("token");
    } catch {}
    latestToken = null;
  } else {
    try {
      localStorage.setItem("token", token);
    } catch {}
    latestToken = token;
  }
}

/* =========================
   NOTIFICATIONS + SOCKET
   ========================= */

let socket = null;
let socketConnected = false;
let socketListeners = new Map(); // event -> Set(handlers)
let reconnectDelayMs = 2000;

// Internal: build auth header token getter (reuses latestToken)
function _getAuthHeader() {
  if (!latestToken) {
    try {
      const t = localStorage.getItem("token");
      if (t) latestToken = t;
    } catch {}
  }
  return latestToken ? { Authorization: `Bearer ${latestToken}` } : {};
}

export function connectSocket({ onNotification, onBookingAccepted } = {}) {
  // allow multiple callers and multiple handlers
  if (onNotification) {
    if (!socketListeners.has("notification:received")) {
      socketListeners.set("notification:received", new Set());
    }
    socketListeners.get("notification:received").add(onNotification);
  }

  if (onBookingAccepted) {
    if (!socketListeners.has("booking:accepted")) {
      socketListeners.set("booking:accepted", new Set());
    }
    socketListeners.get("booking:accepted").add(onBookingAccepted);
  }

  // if already connected return socket
  if (socketConnected) return socket;

  try {
    const url = ROOT; // server root

    // opts: use a function for auth so the handshake always reads the latest token
    const opts = {
      autoConnect: false,
      transports: ["websocket", "polling"],
      auth: () => _getAuthHeader(),
    };

    socket = io(url, opts);

    socket.on("connect", () => {
      socketConnected = true;
      // server should derive user identity from the token in the handshake.
      // If you need explicit room joins, emit here (optional).
    });

    socket.on("disconnect", () => {
      socketConnected = false;
    });

    // forward server notifications to registered handlers
    const notifHandler = (payload) => {
      const set = socketListeners.get("notification:received");
      if (set && set.size) {
        set.forEach((fn) => {
          try {
            fn(payload);
          } catch (e) {
            console.warn("notif handler failed", e?.message || e);
          }
        });
      }
    };

    // server currently emits "notification:new"; keep both for safety
    socket.on("notification:new", notifHandler);
    socket.on("notification:received", notifHandler);

    // forward profile:stats to registered handlers
    socket.on("profile:stats", (payload) => {
      const set = socketListeners.get("profile:stats");
      if (set && set.size) {
        set.forEach((fn) => {
          try {
            fn(payload);
          } catch (e) {
            // swallow handler errors
          }
        });
      }
    });

    // forward booking:accepted to registered handlers
    socket.on("booking:accepted", (payload) => {
      const set = socketListeners.get("booking:accepted");
      if (set && set.size) {
        set.forEach((fn) => {
          try {
            fn(payload);
          } catch (e) {
            console.warn("[socket] booking:accepted handler failed", e?.message || e);
          }
        });
      }
    });

    socket.connect();
  } catch (e) {
    console.warn("[socket] connect failed:", e?.message || e);
    // try reconnect later
    setTimeout(() => {
      try {
        if (!socketConnected) connectSocket({ onNotification, onBookingAccepted });
      } catch {}
    }, reconnectDelayMs);
  }

  return socket;
}

/**
 * disconnectSocket() - removes all notification handlers and disconnects socket
 */
export function disconnectSocket() {
  try {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
      socketConnected = false;
    }
    socketListeners.clear();
  } catch (e) {
    console.warn("[socket] disconnect failed:", e?.message || e);
  }
}

// registerSocketHandler(event, fn) - returns unregister function
export function registerSocketHandler(event, fn) {
  if (typeof event !== "string" || typeof fn !== "function") return () => {};
  if (!socketListeners.has(event)) socketListeners.set(event, new Set());
  socketListeners.get(event).add(fn);

  // ensure socket connected so server can send events
  if (!socketConnected) connectSocket();

  return () => {
    try {
      const set = socketListeners.get(event);
      if (set) set.delete(fn);
    } catch {}
  };
}

// Join booking room so chat + WebRTC can use booking:<id>
export function joinBookingRoom(bookingId, who = "user") {
  if (!bookingId) return Promise.reject(new Error("bookingId required"));

  // ensure socket exists
  if (!socketConnected) connectSocket();

  return new Promise((resolve, reject) => {
    try {
      if (!socket) return reject(new Error("socket_not_ready"));
      socket.emit(
        "join:booking",
        { bookingId, who },
        (resp) => {
          if (resp && resp.ok) resolve(resp);
          else reject(new Error(resp?.error || "join_failed"));
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}



/* Notification REST API helpers */
export async function listNotifications({ limit = 50, before = null } = {}) {
  const params = {};
  if (limit) params.limit = limit;
  if (before) params.before = before;
  const { data } = await api.get("/api/notifications", { params });
  return data;
}

export async function getNotificationsCounts() {
  try {
    const { data } = await api.get("/api/notifications/counts");
    return data;
  } catch (e) {
    return { unread: 0 };
  }
}

export async function markNotificationRead(id) {
  const { data } = await api.put(`/api/notifications/${encodeURIComponent(id)}/read`);
  return data;
}

export async function markAllNotificationsRead() {
  const { data } = await api.put("/api/notifications/read-all");
  return data;
}


/* small helper to drop empties */
function stripEmpty(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === null || typeof v === "undefined") continue;
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
 * - /api/profile/me → client profile
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
  const { data } = await api.get("/api/wallet/topup/init", {
    params: { amountKobo },
  });
  return data;
}

export async function verifyWalletTopup(reference) {
  const { data } = await api.get("/api/wallet/topup/verify", {
    params: { reference },
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

export async function payBookingWithWallet(bookingId) {
  const { data } = await api.post("/api/wallet/pay-booking", {
    bookingId,
  });
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
  const { data } = await api.get("/api/profile/me");
  return data;
}
export async function updateClientProfile(payload) {
  const clean = stripEmpty(payload);
  const { data } = await api.put("/api/profile/me", clean);
  return data;
}

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

/* Pro extras */
export async function updateProProfile(payload) {
  const { data } = await api.put("/api/profile/pro/me", payload);
  return data;
}
export async function getPublicProProfile(proId) {
  const { data } = await api.get(`/api/profile/pro/${proId}`);
  return data;

}

export async function getPublicProfile(username) {
  if (!username) throw new Error("username required");
  const { data } = await api.get(`/api/profile/public/${encodeURIComponent(username)}`);
  return data; // { ok: true, profile, posts: { items, cursor } }
}

// -- insert this immediately after getPublicProfile --

export async function getPublicProfileByUid(uid) {
  if (!uid) throw new Error("uid required");
  const { data } = await api.get(
    `/api/profile/public-by-uid/${encodeURIComponent(uid)}`
  );
  return data; // same shape: { ok: true, profile, posts: { items, cursor } }
}


export async function getProProfileAdmin(proId) {
  const { data } = await api.get(`/api/profile/pro/${proId}/admin`);
  return data;
}

export async function ensureClientProfile() {
  const { data } = await api.post("/api/profile/ensure");
  return data;
}

