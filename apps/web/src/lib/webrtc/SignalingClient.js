// apps/web/src/lib/webrtc/SignalingClient.js
// Tiny helper around Socket.IO just for WebRTC signaling

import { connectSocket, api } from "../api";

function withTimeout(promise, ms = 6000, label = "timeout") {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

// Normalize server/client shapes into ONE safe shape:
// - client often sends: { room, payload }
// - server sometimes forwards: { payload, from }  OR even nested payloads
function normalizeMsg(msg, fallbackRoom) {
  // handle nested payloads: { payload: { payload: ... } }
  const payload = msg?.payload?.payload ?? msg?.payload ?? msg;
  const room = msg?.room || fallbackRoom || null;
  const from = msg?.from || null;
  return { room, from, payload };
}

export default class SignalingClient {
  constructor(room, role = "caller") {
    this.room = room;
    this.role = role;
    this.socket = null;

    this.joined = false;
    this._joinPromise = null;
  }

  connect() {
    if (this.socket) return this.socket;

    this.socket = connectSocket();

    console.log("[SignalingClient] connect", {
      room: this.room,
      role: this.role,
    });

    // Make "join" a promise so we can await it before sending offer/answer/ice
    this._joinPromise = new Promise((resolve) => {
      this.socket.emit(
        "room:join",
        { room: this.room, who: `call:${this.role}` },
        (ack) => {
          console.log("[SignalingClient] room:join ack", ack);
          this.joined = !!ack?.ok;
          resolve(ack);
        }
      );
    });

    return this.socket;
  }

  async ready(timeoutMs = 6000) {
    if (!this.socket) this.connect();
    if (this.joined) return true;

    try {
      const ack = await withTimeout(this._joinPromise, timeoutMs, "join_timeout");
      if (!ack?.ok) {
        console.warn("[SignalingClient] join failed:", ack);
        return false;
      }
      return true;
    } catch (e) {
      console.warn("[SignalingClient] join wait failed:", e?.message || e);
      return false;
    }
  }

  // listen for signaling events (we normalize before giving to your handler)
  on(evt, handler) {
    if (!this.socket) this.connect();

    const wrapped = (msg) => {
      const norm = normalizeMsg(msg, this.room);
      handler(norm); // handler receives { room, from, payload }
    };

    // keep reference so off() can remove correctly
    handler.__wrapped = wrapped;
    this.socket.on(evt, wrapped);
  }

  off(evt, handler) {
    if (!this.socket) return;

    if (handler?.__wrapped) {
      this.socket.off(evt, handler.__wrapped);
      return;
    }

    if (handler) this.socket.off(evt, handler);
    else this.socket.off(evt);
  }

  // always send { room, payload }
  async emit(evt, payload) {
    if (!this.socket) this.connect();

    // ✅ wait for join so iOS/Android won’t miss early signaling
    const ok = await this.ready(6000);
    if (!ok) {
      console.warn("[SignalingClient] emit blocked: not joined", { evt, room: this.room });
      return;
    }

    const body = { room: this.room, payload };

    console.log("[SignalingClient] emit", evt, {
      room: this.room,
      hasPayload: !!payload,
    });

    this.socket.emit(evt, body, (ack) => {
      console.log("[SignalingClient] ack", evt, ack);
    });
  }

  disconnect() {
    if (!this.socket) return;
    console.log("[SignalingClient] disconnect", { room: this.room });

    try {
      this.socket.emit("room:leave", { room: this.room });
    } catch {}

    this.socket = null;
    this.joined = false;
    this._joinPromise = null;
  }

  // get ICE servers from backend
  static async getIceServers() {
    try {
      // ✅ FIXED: must include /api
      const res = await api.get("/api/webrtc/ice");
      const ice = res?.data?.iceServers || res?.data || [];
      console.log("[getIceServers] using backend ICE:", ice);
      return ice;
    } catch (err) {
      console.warn(
        "[getIceServers] backend failed, using default STUN",
        err?.message || err
      );
      return [
        { urls: ["stun:stun.l.google.com:19302"] },
      ];
    }
  }
}
