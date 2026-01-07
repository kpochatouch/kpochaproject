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
      }
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
  emit(evt, payload) {
    if (!this.socket) this.connect();

    const body = { room: this.room, payload };

    console.log("[SignalingClient] emit", evt, {
      room: this.room,
      hasPayload: !!payload,
    });

    this.socket.emit(evt, body, (ack) => {
      console.log("[SignalingClient] ack", evt, ack);
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
        try { this.socket.off(evt, fn); } catch {}
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
    try {
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
        {
          urls: ["stun:stun.l.google.com:19302"],
        },
      ];
    }
  }
}
