// apps/web/src/lib/webrtc/SignalingClient.js
import { connectSocket, api } from "../api";

function withTimeout(promise, ms = 6000, label = "timeout") {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function normalizeMsg(msg, fallbackRoom) {
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

    this._onConnect = null;
  }

  _doJoin() {
    if (!this.socket) return Promise.resolve({ ok: false, error: "no_socket" });

    this.joined = false;

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

    return this._joinPromise;
  }

  connect() {
    if (this.socket) return this.socket;

    this.socket = connectSocket();

    console.log("[SignalingClient] connect", { room: this.room, role: this.role });

    // Re-join after reconnects (mobile network switches, tab sleep, etc.)
    this._onConnect = () => {
      console.log("[SignalingClient] socket connected → joining room", this.room);
      this._doJoin();
    };

    this.socket.on("connect", this._onConnect);

    // If already connected, join now; otherwise join will happen on "connect"
    if (this.socket.connected) {
      this._doJoin();
    }

    return this.socket;
  }

  async ready(timeoutMs = 6000) {
    if (!this.socket) this.connect();
    if (this.joined) return true;

    try {
      // if join hasn't been started yet (e.g. connect not fired), wait for it
      const p = this._joinPromise || this._doJoin();
      const ack = await withTimeout(p, timeoutMs, "join_timeout");
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

  on(evt, handler) {
    if (!this.socket) this.connect();

    const wrapped = (msg) => {
      const norm = normalizeMsg(msg, this.room);
      handler(norm);
    };

    handler.__wrapped = wrapped;
    this.socket.on(evt, wrapped);
  }

  off(evt, handler) {
    if (!this.socket) return;

    if (handler?.__wrapped) return this.socket.off(evt, handler.__wrapped);
    if (handler) this.socket.off(evt, handler);
    else this.socket.off(evt);
  }

  async emit(evt, payload) {
    if (!this.socket) this.connect();

    const ok = await this.ready(6000);
    if (!ok) {
      console.warn("[SignalingClient] emit blocked: not joined", { evt, room: this.room });
      return;
    }

    const body = { room: this.room, payload };

    console.log("[SignalingClient] emit", evt, { room: this.room, hasPayload: !!payload });

    this.socket.emit(evt, body, (ack) => {
      console.log("[SignalingClient] ack", evt, ack);
    });
  }

  disconnect() {
    if (!this.socket) return;

    console.log("[SignalingClient] disconnect", { room: this.room });

    try { this.socket.emit("room:leave", { room: this.room }); } catch {}

    try {
      if (this._onConnect) this.socket.off("connect", this._onConnect);
    } catch {}

    this.socket = null;
    this.joined = false;
    this._joinPromise = null;
    this._onConnect = null;
  }

  static async getIceServers() {
    try {
      const res = await api.get("/api/webrtc/ice");
      const ice = res?.data?.iceServers || res?.data || [];
      console.log("[getIceServers] using backend ICE:", ice);
      return ice;
    } catch (err) {
      console.warn("[getIceServers] backend failed, using default STUN", err?.message || err);
      return [{ urls: ["stun:stun.l.google.com:19302"] }];
    }
  }
}
