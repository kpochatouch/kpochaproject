// apps/web/src/lib/api.js
// Axios + Firebase auth integration + Socket.IO client helpers
// Production-ready helpers for chat, call (audio/video), signaling, notifications, bookings, etc.

import axios from "axios";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { io as ioClient } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";

/* ------------------------
   Helper: canonical DM room
   ------------------------ */
export function createDMRoom(uidA, uidB) {
  if (!uidA || !uidB) return `dm:${uidA || uidB}`;
  if (uidA === uidB) return `dm:${uidA}`;
  return uidA < uidB ? `dm:${uidA}:${uidB}` : `dm:${uidB}:${uidA}`;
}

/* =========================
   BOOKING UI HELPERS (backend-truth)
   ========================= */

/** Convert kobo -> ₦ string (safe) */
export function fmtNairaFromKobo(kobo) {
  const n = Math.floor(Number(kobo || 0));
  return (n / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Read ring timeout from /api/settings.bookingRules.ringTimeoutSeconds (default 120s). */
export function getRingTimeoutMsFromSettings(settings) {
  const secs = Number(settings?.bookingRules?.ringTimeoutSeconds ?? 120);
  return (Number.isFinite(secs) && secs > 0 ? secs : 120) * 1000;
}

/** Ringing remaining ms for scheduled+paid bookings. */
export function getRingingRemainingMs(booking, timeoutMs = 120_000) {
  if (!booking) return 0;
  if (booking.status !== "scheduled") return 0;
  if (booking.paymentStatus !== "paid") return 0;

  const started = booking.ringingStartedAt
    ? new Date(booking.ringingStartedAt).getTime()
    : 0;
  if (!started) return 0;

  const elapsed = Date.now() - started;
  return Math.max(0, timeoutMs - elapsed);
}

/**
 * Booking status label (backend-truth).
 * - status drives the flow
 * - paymentStatus clarifies messaging (paid/refunded)
 */
export function getBookingUiLabel(booking) {
  if (!booking) return "—";

  const s = booking.status;
  const p = booking.paymentStatus;

  // If refunded, always show refunded (even if status is cancelled)
  if (p === "refunded") return "Cancelled — refunded to wallet";

  if (s === "pending_payment") return "Awaiting payment";
  if (s === "scheduled")
    return p === "paid"
      ? "Paid — waiting for pro response"
      : "Awaiting payment";
  if (s === "accepted") return "Accepted — job in progress";
  if (s === "completed") return "Completed";
  if (s === "cancelled") return "Cancelled";

  return s || "Unknown";
}

/**
 * IMPORTANT:
 * Instant cashout eligibility cannot be computed from booking.meta in this backend.
 * Payout logic is NOT stored as booking.meta.instantCashout.
 *
 * Backend truth:
 * - Pro pending is credited ONLY on booking completion (creditProPendingForBooking)
 * - Auto-release pending→available after settings.payouts.releaseDays (default 7)
 * - Instant cashout (if you expose it) is usually: pending→available with fee (withdrawPendingWithFee)
 *
 * Therefore, UI should NOT guess per-booking cashout eligibility from booking.meta.
 * Instead, show cashout button based on wallet.pendingKobo > 0 and (optional) a hold window.
 */
export function getInstantCashoutEligibility({
  booking,
  settings,
  wallet,
} = {}) {
  const holdDays = Number(settings?.payouts?.instantCashoutHoldDays ?? 3);

  // if no pending balance, nothing to cashout
  const pending = Number(
    wallet?.wallet?.pendingKobo ?? wallet?.pendingKobo ?? 0,
  );
  if (!pending || pending <= 0)
    return { eligible: false, reason: "no_pending", holdDays };

  // If you want a strict hold, enforce it *only if booking.completedAt exists*
  // (best-effort: hold is about time after completion)
  const completedAtMs = booking?.completedAt
    ? new Date(booking.completedAt).getTime()
    : 0;
  if (!completedAtMs)
    return { eligible: true, reason: "ok_wallet_based", holdDays };

  const cutoff = Date.now() - holdDays * 24 * 60 * 60 * 1000;
  if (completedAtMs > cutoff) {
    return {
      eligible: false,
      reason: "hold_active",
      holdDays,
      availableAtMs: completedAtMs + holdDays * 24 * 60 * 60 * 1000,
    };
  }

  return { eligible: true, reason: "ok", holdDays };
}

/* =========================================
   BASE URL (normalize, no trailing slash, no /api suffix)
   ========================================= */
let ROOT = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  ""
)
  .toString()
  .trim();

if (!ROOT) {
  ROOT = "http://localhost:8080";
}
ROOT = ROOT.replace(/\/+$/, "");
if (/\/api$/i.test(ROOT)) ROOT = ROOT.replace(/\/api$/i, "");

/* =========================
   AXIOS client
   - baseURL points at root (we call /api/... everywhere)
   - withCredentials=true so anonId cookie sent
   ========================= */
export const api = axios.create({
  baseURL: ROOT,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  withCredentials: true,
});

/* =========================================
   AUTH HANDLING (Firebase)
   - listens to auth state changes
   - attempts to fetch fresh ID token before each request
   - supports manual setAuthToken() (used by Login.jsx)
   ========================================= */
let firebaseAuth = null;
let authListenerStarted = false;
let latestToken = null;

// optional hook for token changes
export let onTokenChange = null;

function ensureAuthListener() {
  if (authListenerStarted) return;
  authListenerStarted = true;
  try {
    firebaseAuth = getAuth();
    onAuthStateChanged(firebaseAuth, async (user) => {
      if (user) {
        try {
          // 🔥 force a fresh token when user logs in
          const t = await user.getIdToken(true);
          latestToken = t;
          try {
            localStorage.setItem("token", t);
          } catch {}
          if (typeof onTokenChange === "function") onTokenChange(t);
        } catch {
          // ignore
        }
      } else {
        latestToken = null;
        try {
          localStorage.removeItem("token");
        } catch {}
        if (typeof onTokenChange === "function") onTokenChange(null);
      }
    });
  } catch {
    // firebase not available (SSR/build)
  }
}
ensureAuthListener();

api.interceptors.request.use(async (config) => {
  ensureAuthListener();

  // 1) Try to get fresh token from Firebase (if available)
  if (firebaseAuth) {
    const user = firebaseAuth.currentUser;
    if (user) {
      try {
        const fresh = await user.getIdToken();
        if (fresh) {
          latestToken = fresh;
          config.headers.Authorization = `Bearer ${fresh}`;
          return config;
        }
      } catch {
        // ignore and fall back
      }
    }
  }

  // 2) Use latestToken if present
  if (latestToken) {
    config.headers.Authorization = `Bearer ${latestToken}`;
    return config;
  }

  // 3) Fallback to localStorage-saved token (used by some login flows)
  try {
    const t = localStorage.getItem("token");
    if (t) {
      latestToken = t;
      config.headers.Authorization = `Bearer ${t}`;
    }
  } catch {}

  return config;
});

/* manual override used by Login.jsx after sign-in */
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
  // notify socket about token change (socket will refresh auth on next connect)
  if (typeof onTokenChange === "function") onTokenChange(latestToken);
}

/* =========================
   SOCKET + NOTIFICATIONS + CALLS + WEBRTC
   ========================= */

/*
  Design notes:
  - socket is connected to ROOT (server root)
  - auth for socket is provided as a function that returns an object (token header)
  - when token changes (onTokenChange), we refresh socket.auth and reconnect if needed
  - we keep a registry of listeners so components can register/unregister handlers
  - we expose helpers for chat sends (socket with REST fallback), call lifecycle, webrtc signaling
*/

let socket = null;
let socketConnected = false;
let socketBootstrapStarted = false; // 🔐 hard singleton guard
let wiredEvents = new Set();
let socketListeners = new Map(); // event -> Set(fn)
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 12;
const BASE_RECONNECT_DELAY = 1000;

/* helper: return auth object for socket.io (object or function allowed)
   socket.io client accepts either auth: { token } or auth: () => ({ token }) */
function _getAuthPayload() {
  const payload = {};

  // prefer latestToken, fallback to localStorage
  if (!latestToken) {
    try {
      const t = localStorage.getItem("token");
      if (t) latestToken = t;
    } catch {}
  }

  if (latestToken) payload.token = latestToken;

  // Always hint uid if Firebase knows it (backend uses it if token missing)
  try {
    if (firebaseAuth && firebaseAuth.currentUser?.uid) {
      payload.uid = firebaseAuth.currentUser.uid;
    }
  } catch {}

  return payload;
}

/* generic dispatcher: forwards payload to registered handlers */
function _dispatch(event, payload) {
  const set = socketListeners.get(event);
  if (!set || !set.size) return;
  for (const fn of Array.from(set)) {
    try {
      fn(payload);
    } catch (e) {
      console.warn(`[socket] handler ${event} failed:`, e?.message || e);
    }
  }
}

/* ensure socket has one .on for the event which forwards to registered handlers */
function _ensureWire(event) {
  if (!socket || wiredEvents.has(event)) return;
  wiredEvents.add(event);
  socket.on(event, (payload) => _dispatch(event, payload));
}

/* graceful reconnect delay */
function _reconnectWithBackoff() {
  if (!socket) return;
  reconnectAttempts++;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.warn("[socket] max reconnect attempts reached");
    return;
  }
  const delay = Math.min(
    60_000,
    BASE_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts),
  );
  setTimeout(() => {
    try {
      if (socket && !socket.connected) socket.connect();
    } catch (e) {
      console.warn("[socket] reconnect attempt failed:", e?.message || e);
    }
  }, delay);
}

onTokenChange = (newToken) => {
  latestToken = newToken;
  if (!socket) return;

  // update auth only — let socket.io manage reconnect internally
  try {
    socket.auth = _getAuthPayload();
  } catch {}
};

/* connectSocket: idempotent, registers optional callbacks */
export function connectSocket({
  onNotification,
  onBookingAccepted,
  onBookingPaid,
  onCallEvent,
} = {}) {
  // add listeners to registry (idempotent) — add directly to socketListeners to avoid recursion
  if (onNotification) {
    if (!socketListeners.has("notification:received"))
      socketListeners.set("notification:received", new Set());
    socketListeners.get("notification:received").add(onNotification);
  }
  if (onBookingAccepted) {
    if (!socketListeners.has("booking:accepted"))
      socketListeners.set("booking:accepted", new Set());
    socketListeners.get("booking:accepted").add(onBookingAccepted);
  }
  if (onBookingPaid) {
    if (!socketListeners.has("booking:paid"))
      socketListeners.set("booking:paid", new Set());
    socketListeners.get("booking:paid").add(onBookingPaid);
  }
  if (onCallEvent) {
    if (!socketListeners.has("call:status"))
      socketListeners.set("call:status", new Set());
    socketListeners.get("call:status").add(onCallEvent);
  }

  // 🔐 HARD GUARD: socket bootstrap must run once per tab lifetime
  if (socketBootstrapStarted) {
    return socket;
  }
  socketBootstrapStarted = true;

  try {
    const opts = {
      autoConnect: false,
      transports: ["websocket", "polling"],
      path: "/socket.io",
      // 🔥 ask Firebase for a fresh token on each (re)connect
      auth: (cb) => {
        try {
          const auth = firebaseAuth || getAuth();
          const user = auth.currentUser;
          if (!user) {
            cb(_getAuthPayload()); // probably just uid hint or empty
            return;
          }

          // force refresh, then update our cache + send to server
          user
            .getIdToken(true)
            .then((t) => {
              latestToken = t;
              try {
                localStorage.setItem("token", t);
              } catch {}
              cb({
                ..._getAuthPayload(),
                token: t,
                uid: user.uid,
              });
            })
            .catch((err) => {
              console.warn(
                "[socket] getIdToken(true) failed:",
                err?.message || err,
              );
              cb(_getAuthPayload()); // fallback to whatever we have
            });
        } catch (e) {
          console.warn("[socket] auth callback failed:", e?.message || e);
          cb(_getAuthPayload());
        }
      },
    };

    socket = ioClient(ROOT, opts);

    socket.on("connect", () => {
      socketConnected = true;
      reconnectAttempts = 0;

      wiredEvents.clear();

      // wire already-registered events
      for (const ev of socketListeners.keys()) {
        _ensureWire(ev);
      }

      // common server events we want always
      _ensureWire("notification:new");
      _ensureWire("notification:received");
      _ensureWire("chat:message");
      _ensureWire("presence:join");
      _ensureWire("presence:leave");
      _ensureWire("call:initiate");
      _ensureWire("call:accepted");
      _ensureWire("call:ended");
      _ensureWire("call:missed");

      // ✅ bookings
      _ensureWire("booking:accepted");
      _ensureWire("booking:paid"); // ✅ emitted by payments/verify

      // webrtc
      _ensureWire("webrtc:offer");
      _ensureWire("webrtc:answer");
      _ensureWire("webrtc:ice");
    });

    socket.on("disconnect", (reason) => {
      socketConnected = false;
      // do not clear listeners — keep registry for next connect
      if (reason === "io server disconnect") {
        try {
          socket.connect();
        } catch {}
      } else {
        _reconnectWithBackoff();
      }
    });

    socket.on("connect_error", (err) => {
      socketConnected = false;
      console.warn("[socket] connect_error:", err?.message || err);
      _reconnectWithBackoff();
    });

    // bridge notification events -> unified "notification:received"
    socket.on("notification:new", (payload) =>
      _dispatch("notification:received", payload),
    );
    socket.on("notification:received", (payload) =>
      _dispatch("notification:received", payload),
    );

    // Ensure we always listen for booking events on user room.
    // NOTE: server emits booking:accepted to `user:<uid>` and also `booking:<id>`.
    // booking:paid may NOT always be emitted (webhook path doesn't emit sockets),
    // so UI must still verify/poll booking status after payment redirect.

    socket.connect();
  } catch (e) {
    console.warn("[socket] connect failed:", e?.message || e);
    _reconnectWithBackoff();
  }

  return socket;
}

/** disconnect and clear handlers */
export function disconnectSocket() {
  try {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
  } catch (e) {
    console.warn("[socket] disconnect failed:", e?.message || e);
  } finally {
    socket = null;
    socketConnected = false;
    wiredEvents.clear();
    socketListeners.clear();
  }
}

/** registerSocketHandler(event, fn): returns unregister() */
export function registerSocketHandler(event, fn) {
  if (typeof event !== "string" || typeof fn !== "function") return () => {};
  if (!socketListeners.has(event)) socketListeners.set(event, new Set());
  socketListeners.get(event).add(fn);

  // ensure socket exists and event wired
  if (!socketConnected) connectSocket();
  else _ensureWire(event);

  return () => {
    try {
      const s = socketListeners.get(event);
      if (s) s.delete(fn);
    } catch {}
  };
}

/* Helper: join booking room (for chat + webrtc) */
export function joinBookingRoom(bookingId, who = "user") {
  if (!bookingId) return Promise.reject(new Error("bookingId required"));
  if (!socketConnected) connectSocket();
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error("socket_not_ready"));
    socket.emit("join:booking", { bookingId, who }, (resp) => {
      if (resp && resp.ok) resolve(resp);
      else reject(new Error(resp?.error || "join_failed"));
    });
  });
}

// Ensure socket is connected before we try to send chat.
// If it can't connect in time, we reject and caller falls back to REST.
async function ensureSocketReady(timeoutMs = 8000) {
  // already connected
  if (socket && socket.connected) return socket;

  // start or retry connection
  connectSocket();

  return await new Promise((resolve, reject) => {
    const start = Date.now();

    function check() {
      if (socket && socket.connected) {
        return resolve(socket);
      }
      if (Date.now() - start >= timeoutMs) {
        return reject(new Error("socket_timeout"));
      }
      setTimeout(check, 200);
    }

    check();
  });
}

/* -----------------------
   Chat send: prefer socket, fallback to REST
   - returns { ok, id, existing } or throws
   ----------------------- */
export async function sendChatMessage({
  room,
  text = "",
  meta = {},
  clientId = null,
}) {
  const hasText = !!(text && text.trim());
  const hasAttachments =
    Array.isArray(meta?.attachments) && meta.attachments.length > 0;
  const hasCallMeta = !!meta?.call;

  if (!hasText && !hasAttachments && !hasCallMeta) {
    throw new Error("message_empty");
  }

  // ensure clientId exists (server dedupe expects this)
  if (!clientId) clientId = `c_${uuidv4()}`;

  const payload = { room, text, meta, clientId };

  // 1️⃣ Try to make sure socket is ready
  try {
    const s = await ensureSocketReady(6000); // wait up to 6s for connect

    return await new Promise((resolve, reject) => {
      try {
        s.emit("chat:message", payload, (ack) => {
          if (!ack) return reject(new Error("no_ack"));
          if (ack.ok) return resolve({ ...ack, clientId });
          return reject(new Error(ack.error || "send_failed"));
        });
      } catch (e) {
        console.warn(
          "[chat] socket emit failed, falling back to REST:",
          e?.message || e,
        );
        _sendChatMessageRest(payload)
          .then((d) => resolve({ ...d, clientId }))
          .catch(reject);
      }
    });
  } catch (e) {
    // 2️⃣ Socket couldn't get ready in time → REST fallback
    console.warn("[chat] socket not ready, using REST:", e?.message || e);
    const data = await _sendChatMessageRest(payload);
    return { ...data, clientId };
  }
}

async function _sendChatMessageRest({
  room,
  text,
  meta = {},
  clientId = null,
}) {
  const payload = { room, text, meta, clientId };
  // backend may expose an endpoint like POST /api/chat/send or POST /api/chat/room/:room/message
  // we call POST /api/chat/room/:room/message (safe default)
  try {
    const { data } = await api.post(
      `/api/chat/room/${encodeURIComponent(room)}/message`,
      payload,
    );
    return data;
  } catch (err) {
    // Try alternative endpoint (older backend): /api/chat
    try {
      const { data } = await api.post("/api/chat", payload);
      return data;
    } catch (e) {
      const msg = err?.response?.data?.error || err?.message || "send_failed";
      throw new Error(msg);
    }
  }
}

/* -----------------------
   CALLS (audio/video)
   - initiateCall -> tries socket emit 'call:initiate' (ack) then returns server record (id, callId, room)
   - updateCallStatus -> emit 'call:status' (socket) and also call REST fallback
   ----------------------- */

export async function initiateCall({
  receiverUid,
  callType = "audio",
  meta = {},
  room = null,
  callId = null,
} = {}) {
  if (!receiverUid) throw new Error("receiverUid required");

  // try socket first
  if (socket && socket.connected) {
    return new Promise((resolve, reject) => {
      try {
        socket.emit(
          "call:initiate",
          { receiverUid, callType, meta, room, callId },
          (ack) => {
            if (!ack) return reject(new Error("no_ack"));
            if (ack.ok) return resolve(ack);
            return reject(new Error(ack.error || "call_init_failed"));
          },
        );
      } catch (e) {
        console.warn(
          "[call] socket initiate failed, falling back to REST:",
          e?.message || e,
        );
        _initiateCallRest({ receiverUid, callType, meta, room, callId })
          .then(resolve)
          .catch(reject);
      }
    });
  }

  return _initiateCallRest({ receiverUid, callType, meta, room, callId });
}

async function _initiateCallRest(payload) {
  // backend has POST /api/call
  try {
    const { data } = await api.post("/api/call", payload);
    return data;
  } catch (e) {
    throw new Error(
      e?.response?.data?.error || e?.message || "call_init_failed",
    );
  }
}

export async function updateCallStatus({
  id = null,
  callId = null,
  status,
  meta = {},
} = {}) {
  if (!status) throw new Error("status required");
  const body = { status, meta, id, callId };

  // prefer socket: emit call:status
  if (socket && socket.connected) {
    return new Promise((resolve, reject) => {
      try {
        socket.emit("call:status", body, (ack) => {
          if (!ack) return reject(new Error("no_ack"));
          if (ack.ok) return resolve(ack);
          return reject(new Error(ack.error || "call_status_failed"));
        });
      } catch (e) {
        console.warn(
          "[call] socket status failed, falling back to REST:",
          e?.message || e,
        );
        _updateCallStatusRest({ id, callId, status, meta })
          .then(resolve)
          .catch(reject);
      }
    });
  }

  return _updateCallStatusRest({ id, callId, status, meta });
}

async function _updateCallStatusRest({
  id = null,
  callId = null,
  status,
  meta = {},
} = {}) {
  try {
    // Prefer canonical callId first
    if (callId) {
      const { data } = await api.put(
        `/api/call/${encodeURIComponent(String(callId))}/status`,
        { status, meta },
      );
      return data;
    } else if (id) {
      const { data } = await api.put(
        `/api/call/${encodeURIComponent(String(id))}/status`,
        { status, meta },
      );
      return data;
    } else {
      throw new Error("id_or_callId_required");
    }
  } catch (e) {
    throw new Error(
      e?.response?.data?.error || e?.message || "call_status_failed",
    );
  }
}

/* -----------------------
   WEBRTC signaling helpers (emit & register)
   - emitWebRTC(event, room, payload) for offer/answer/ice
   - registerSocketHandler for webrtc events already wired
   ----------------------- */

export function emitWebRTC(event, { room, payload } = {}) {
  if (!["webrtc:offer", "webrtc:answer", "webrtc:ice"].includes(event)) {
    throw new Error("invalid_webrtc_event");
  }
  if (!room || !payload) throw new Error("room_and_payload_required");

  if (socket && socket.connected) {
    socket.emit(event, { room, payload }, (ack) => {
      // optional ack handling; typically webrtc signaling acks aren't used
    });
    return true;
  }

  // if socket not available, caller should ensure connectSocket() before calling
  throw new Error("socket_not_connected");
}

/* =========================
   REST helpers (kept from original file)
   - most of your previous REST functions copied unchanged
   ========================= */

/* Chat / Inbox / Thread helpers */
export async function getChatWith(peerUid, params = {}) {
  if (!peerUid) throw new Error("peerUid required");
  const { data } = await api.get(
    `/api/chat/with/${encodeURIComponent(peerUid)}`,
    { params },
  );
  return data;
}
/**
 * getChatInbox(options)
 * options:
 *   - cursor: string | null   (pagination cursor / timestamp)
 *   - limit: number
 *   - q: string               (optional search)
 *
 * Returns whatever the backend provides (array OR { items, cursor, hasMore }).
 */
export async function getChatInbox({ cursor = null, limit = 40, q = "" } = {}) {
  const params = {};
  if (cursor) params.cursor = cursor;
  if (limit) params.limit = Number(limit || 40);
  if (q) params.q = q;

  const { data } = await api.get("/api/chat/inbox", { params });
  return data;
}

export async function markThreadRead(peerUid) {
  if (!peerUid) throw new Error("peerUid required");
  const { data } = await api.put(
    `/api/chat/thread/${encodeURIComponent(peerUid)}/read`,
  );
  return data;
}
export async function markRoomRead(room) {
  if (!room) throw new Error("room required");
  const { data } = await api.put(
    `/api/chat/room/${encodeURIComponent(room)}/read`,
  );
  return data;
}

/* Notifications */
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
  const { data } = await api.put(
    `/api/notifications/${encodeURIComponent(id)}/read`,
  );
  return data;
}
export async function markAllNotificationsRead() {
  const { data } = await api.put("/api/notifications/read-all");
  return data;
}

/* Basic / profile / bundle helpers */
export async function getMe() {
  const { data } = await api.get("/api/me");
  return data;
}
export async function getProMe() {
  try {
    const { data } = await api.get("/api/pros/me");
    return data;
  } catch {
    return null;
  }
}
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

/* Geo */
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
    `/api/geo/ng/lgas/${encodeURIComponent(stateName)}`,
  );
  return data;
}
export async function reverseGeocode({ lat, lon }) {
  const { data } = await api.get("/api/geo/rev", { params: { lat, lon } });
  return data;
}

/* Browsing pros */
export async function listBarbers(params = {}) {
  const { data } = await api.get("/api/barbers", { params });
  return data;
}
export async function getBarber(id) {
  const { data } = await api.get(`/api/barbers/${id}`);
  return data;
}
export async function listNearbyBarbers({ lat, lon, radiusKm = 25 }) {
  const { data } = await api.get("/api/barbers/nearby", {
    params: { lat, lon, radiusKm },
  });
  return data;
}

/* Feed */
export async function listPublicFeed(params = {}) {
  const { data } = await api.get("/api/posts/public", { params });
  return data;
}
export async function createPost(payload) {
  const { data } = await api.post("/api/posts", payload);
  return data;
}

/* Payments (Paystack) */
export async function verifyPayment({ bookingId, reference }) {
  const { data } = await api.post("/api/payments/verify", {
    bookingId,
    reference,
  });
  return data;
}
export async function initPayment({ bookingId, email }) {
  const { data } = await api.post("/api/payments/init", { bookingId, email });
  return data;
}

/* Bookings client */
export async function createBooking(payload) {
  const { data } = await api.post("/api/bookings", payload);
  return data.booking;
}
export async function createInstantBooking(payload) {
  const { data } = await api.post("/api/bookings/instant", payload);
  return data;
}
export async function setBookingReference(bookingId, paystackReference) {
  const { data } = await api.put(`/api/bookings/${bookingId}/reference`, {
    paystackReference,
  });
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

/* Bookings - pro */
export async function getProBookings() {
  const { data } = await api.get("/api/bookings/pro/me");
  return data;
}
export async function acceptBooking(id) {
  const { data } = await api.put(`/api/bookings/${id}/accept`);
  return data.booking;
}

export async function completeBooking(id, payload = {}) {
  const { data } = await api.put(`/api/bookings/${id}/complete`, payload);
  return data.booking;
}

/* Bookings - pro (extra) */
export async function cancelBookingByPro(id, payload = {}) {
  const { data } = await api.put(`/api/bookings/${id}/cancel-by-pro`, payload);
  return data.booking || data;
}

// Alias (UI can still say "Decline")
export async function declineBooking(id, payload = {}) {
  return cancelBookingByPro(id, payload);
}

/* Admin wallets */
export async function getEscrowWalletAdmin() {
  const { data } = await api.get("/api/wallet/escrow");
  return data;
}
export async function getPlatformWalletAdmin() {
  const { data } = await api.get("/api/wallet/platform");
  return data;
}
export async function setPlatformRecipientCode(recipientCode) {
  const { data } = await api.post("/api/wallet/platform/recipient", {
    recipientCode,
  });
  return data;
}
export async function withdrawPlatformToBank(amountKobo) {
  const { data } = await api.post("/api/wallet/platform/withdraw", {
    amountKobo,
  });
  return data;
}

/* Reviews (unchanged) */
export async function createProReview(opts) {
  const { data } = await api.post("/api/reviews", opts);
  return data;
}
export async function getProReviews(proId) {
  const { data } = await api.get(
    `/api/reviews/pro/${encodeURIComponent(proId)}`,
  );
  return data;
}
export async function getMyReviewOnPro(proId) {
  const { data } = await api.get(
    `/api/reviews/pro/${encodeURIComponent(proId)}/me`,
  );
  return data;
}
export async function createClientReview(opts) {
  const { data } = await api.post("/api/reviews/client", opts);
  return data;
}
export async function getClientReviews(clientUid) {
  const { data } = await api.get(
    `/api/reviews/client/${encodeURIComponent(clientUid)}`,
  );
  return data;
}
export async function getMyReviewOnClient(clientUid) {
  const { data } = await api.get(
    `/api/reviews/client/${encodeURIComponent(clientUid)}/me`,
  );
  return data;
}

/* Wallet */
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
export async function withdrawPendingToAvailable() {
  throw new Error(
    "withdraw_pending_endpoint_removed_use_instantCashoutForBooking",
  );
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
export async function getClientWalletMe() {
  const { data } = await api.get("/api/wallet/client/me");
  return data;
}
export async function payBookingWithWallet(bookingId) {
  const { data } = await api.post("/api/wallet/pay-booking", { bookingId });
  return data;
}

/* Payout (instant cashout per booking) */
export async function instantCashoutForBooking(bookingId) {
  if (!bookingId) throw new Error("bookingId required");
  const { data } = await api.post(
    `/api/payouts/instant-cashout/${encodeURIComponent(String(bookingId))}`,
  );
  return data;
}

/* PIN */
export async function setWithdrawPin(pin) {
  const { data } = await api.post("/api/pin/me/set", { pin });
  return data;
}
export async function resetWithdrawPin(currentPin, newPin) {
  const { data } = await api.put("/api/pin/me/reset", { currentPin, newPin });
  return data;
}

/* Settings */
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

/* Pro / profile / applications */
export async function submitProApplication(payload) {
  const { data } = await api.post("/api/applications", payload);
  return data;
}
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
export async function getClientProfileForBooking(clientUid, bookingId) {
  const { data } = await api.get(
    `/api/profile/client/${clientUid}/for-booking/${encodeURIComponent(
      bookingId,
    )}`,
  );
  return data;
}
export async function getClientProfileAdmin(clientUid) {
  const { data } = await api.get(`/api/profile/client/${clientUid}/admin`);
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
export async function getPublicProfile(username) {
  if (!username) throw new Error("username required");
  const { data } = await api.get(
    `/api/profile/public/${encodeURIComponent(username)}`,
  );
  return data;
}
export async function getPublicProfileByUid(uid) {
  if (!uid) throw new Error("uid required");
  const { data } = await api.get(
    `/api/profile/public-by-uid/${encodeURIComponent(uid)}`,
  );
  return data;
}
export async function getProProfileAdmin(proId) {
  const { data } = await api.get(`/api/profile/pro/${proId}/admin`);
  return data;
}
export async function ensureClientProfile() {
  const { data } = await api.post("/api/profile/ensure");
  return data;
}

/* helpers */
function stripEmpty(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === null || typeof v === "undefined") continue;
    if (typeof v === "number" && Number.isNaN(v)) continue;
    out[k] = v;
  }
  return out;
}

/* aliases kept for compatibility */
export const fetchNotifications = listNotifications;
export const fetchNotificationCounts = getNotificationsCounts;
export const markNotificationSeen = markNotificationRead;
export const markAllNotificationsSeen = markAllNotificationsRead;

/* default export (convenience) */
export default {
  api,

  // auth
  ensureAuthListener,
  setAuthToken,

  // socket
  connectSocket,
  disconnectSocket,
  registerSocketHandler,
  joinBookingRoom,

  // chat
  sendChatMessage,
  getChatWith,
  getChatInbox,
  markThreadRead,
  markRoomRead,

  // notifications
  listNotifications,
  getNotificationsCounts,
  markNotificationRead,
  markAllNotificationsRead,

  // calls / webrtc
  initiateCall,
  updateCallStatus,
  emitWebRTC,

  // bundle + profiles
  getMe,
  getClientProfile,
  updateClientProfile,
  ensureClientProfile,
  loadMeBundle,

  // booking UI helpers
  fmtNairaFromKobo,
  getRingingRemainingMs,
  getBookingUiLabel,
  getInstantCashoutEligibility,

  // payout
  instantCashoutForBooking,
  // booking (extra)
  cancelBookingByPro,
  declineBooking,

  // admin wallets
  getEscrowWalletAdmin,
  getPlatformWalletAdmin,
  setPlatformRecipientCode,
  withdrawPlatformToBank,

  // booking helper
  getRingTimeoutMsFromSettings,
};
