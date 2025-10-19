import { io } from "socket.io-client";

export default class SignalingClient {
  constructor(room, me) {
    this.room = room;
    this.me = me || "client";

    const url =
      import.meta.env.VITE_SOCKET_URL ||
      import.meta.env.VITE_API_BASE_URL ||
      window.location.origin;

    this.socket = io(url, { transports: ["websocket"], path: "/socket.io" });

    this.handlers = {};
    this.socket.on("connect", () => {
      this.socket.emit("room:join", { room, who: this.me });
    });

    ["webrtc:offer", "webrtc:answer", "webrtc:ice"].forEach((evt) => {
      this.socket.on(evt, (payload) => this._emitLocal(evt, payload));
    });

    this.socket.on("disconnect", () => {});
  }

  /**
   * Preferred: fetch ICE servers from backend API, then fall back to env.
   * Usage:
   *   const iceServers = await SignalingClient.getIceServers();
   *   const pc = new RTCPeerConnection({ iceServers });
   */
  static async getIceServers() {
    const base =
      import.meta.env.VITE_API_BASE_URL || window.location.origin;

    try {
      const res = await fetch(`${base}/api/webrtc/ice`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
          return data.iceServers;
        }
      }
    } catch (err) {
      console.warn("[SignalingClient] ICE fetch failed, falling back to env:", err?.message || err);
    }

    return SignalingClient.buildIceServersFromEnv();
  }

  /** Fallback: build ICE from .env (VITE_STUN_URLS, VITE_TURN_URLS, etc.) */
  static buildIceServersFromEnv() {
    const stun = (import.meta.env.VITE_STUN_URLS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const turn = (import.meta.env.VITE_TURN_URLS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const username = import.meta.env.VITE_TURN_USERNAME || "";
    const credential = import.meta.env.VITE_TURN_PASSWORD || "";

    const out = [];
    if (stun.length) out.push({ urls: stun });
    if (turn.length) out.push({ urls: turn, username, credential });

    return out.length ? out : [{ urls: ["stun:stun.l.google.com:19302"] }];
  }

  on(evt, fn) {
    this.handlers[evt] = this.handlers[evt] || [];
    this.handlers[evt].push(fn);
  }

  _emitLocal(evt, payload) {
    (this.handlers[evt] || []).forEach((fn) => fn(payload));
  }

  emit(evt, payload) {
    this.socket.emit(evt, { room: this.room, from: this.me, payload });
  }

  disconnect() {
    try {
      this.socket.disconnect();
    } catch {}
  }
}
