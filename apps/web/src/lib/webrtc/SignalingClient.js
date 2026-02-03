// apps/web/src/lib/webrtc/SignalingClient.js
// Tiny helper around Socket.IO just for WebRTC signaling

import { connectSocket, api } from "../api";

export default class SignalingClient {
  constructor(room, role = "caller") {
    this.room = room;
    this.role = role;
    this.socket = null;
    this.joined = false;
    this._handlers = new Map(); // evt -> Set(handlers)
  }

  // connect and join the call room
  connect() {
    if (this.socket) return this.socket;

    this.socket = connectSocket();
    console.log("[SignalingClient] connect", {
      room: this.room,
      role: this.role,
    });

    this.socket.emit(
      "room:join",
      { room: this.room, who: `call:${this.role}` },
      (ack) => {
        console.log("[SignalingClient] room:join ack", ack);
        this.joined = !!ack?.ok;
      },
    );

    return this.socket;
  }

  // listen for signaling events
  on(evt, handler) {
    if (!this.socket) this.connect();
    if (!handler) return;

    this.socket.on(evt, handler);

    if (!this._handlers.has(evt)) this._handlers.set(evt, new Set());
    this._handlers.get(evt).add(handler);
  }

  off(evt, handler) {
    if (!this.socket) return;
    if (!evt) return;

    // remove one handler
    if (handler) {
      this.socket.off(evt, handler);
      const set = this._handlers.get(evt);
      if (set) set.delete(handler);
      return;
    }

    // remove ALL handlers we registered for this evt
    const set = this._handlers.get(evt);
    if (set) {
      for (const fn of set) this.socket.off(evt, fn);
      set.clear();
    }
  }

  // *** THIS IS THE IMPORTANT PART ***
  // always send { room, payload } so backend handler matches
  emit(evt, payload, ackCb) {
    if (!this.socket) this.connect();

    const body = { room: this.room, payload };

    console.log("[SignalingClient] emit", evt, {
      room: this.room,
      hasPayload: !!payload,
    });

    this.socket.emit(evt, body, (ack) => {
      console.log("[SignalingClient] ack", evt, ack);
      try {
        if (typeof ackCb === "function") ackCb(ack);
      } catch {}
    });
  }

  // leave the room
  disconnect() {
    if (!this.socket) return;
    console.log("[SignalingClient] disconnect", { room: this.room });

    // ✅ remove all listeners registered by THIS SignalingClient instance
    try {
      for (const [evt, set] of this._handlers.entries()) {
        for (const fn of set) {
          try {
            this.socket.off(evt, fn);
          } catch {}
        }
      }
      this._handlers.clear();
    } catch {}

    this.socket.emit("room:leave", { room: this.room });
    this.socket = null;
    this.joined = false;
  }

  // get ICE servers from backend
  static async getIceServers() {
    // IMPORTANT:
    // Your Android log shows DNS failures resolving *.metered.ca.
    // So on native (Capacitor), we filter those out to avoid ICE failure.
    // We always add a known-good STUN fallback.

    const isNative =
      typeof window !== "undefined" &&
      !!window?.Capacitor?.isNativePlatform?.() &&
      window.Capacitor.isNativePlatform();

    const SAFE_STUN = [
      {
        urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
      },
    ];

    function normalizeIce(list) {
      const arr = Array.isArray(list) ? list : [];
      return arr
        .map((s) => {
          if (!s) return null;
          // allow either {urls: "..."} or {urls:[...]}
          const urls = Array.isArray(s.urls) ? s.urls : s.urls ? [s.urls] : [];
          return { ...s, urls };
        })
        .filter(Boolean);
    }

    function filterBadHosts(servers) {
      // Filter out metered.* hosts that fail DNS on some mobile networks
      // (error -105 in your adb logcat).
      const BAD = ["metered.ca"];

      return servers
        .map((s) => {
          const urls = (s.urls || []).filter((u) => {
            const lu = String(u || "").toLowerCase();
            return !BAD.some((h) => lu.includes(h));
          });
          return { ...s, urls };
        })
        .filter((s) => (s.urls || []).length);
    }

    try {
      const res = await api.get("/api/webrtc/ice");
      const raw = res?.data?.iceServers || res?.data || [];
      let ice = normalizeIce(raw);

      if (isNative) {
        ice = filterBadHosts(ice);
      }

      // Always include safe STUN at the end
      ice = [...ice, ...SAFE_STUN];

      console.log("[getIceServers] using ICE:", { isNative, ice });
      return ice;
    } catch (err) {
      console.warn(
        "[getIceServers] backend failed, using SAFE STUN",
        err?.message || err,
      );
      return SAFE_STUN;
    }
  }
}
