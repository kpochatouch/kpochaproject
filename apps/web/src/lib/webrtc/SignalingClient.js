// apps/web/src/lib/webrtc/SignalingClient.js
// Tiny helper around Socket.IO just for WebRTC signaling

import { connectSocket, api } from "../api";

export default class SignalingClient {
  constructor(room, role = "caller") {
    this.room = room;
    this.role = role;
    this.socket = null;
    this.joined = false;
    this.joining = false;

    this._handlers = new Map(); // evt -> Set(handlers)

    // ✅ queue emits until room:join ack says ok
    this._outbox = []; // [{ evt, payload, ackCb }]
  }

  connect() {
    if (this.socket) return this.socket;

    this.socket = connectSocket();
    console.log("[SignalingClient] connect", {
      room: this.room,
      role: this.role,
    });

    this.joining = true;

    this.socket.emit(
      "room:join",
      { room: this.room, who: `call:${this.role}` },
      (ack) => {
        console.log("[SignalingClient] room:join ack", ack);

        this.joined = !!ack?.ok;
        this.joining = false;

        // ✅ flush any queued signaling that happened before join completed
        if (this.joined && this._outbox.length) {
          const queued = [...this._outbox];
          this._outbox.length = 0;
          for (const item of queued) {
            try {
              this._emitNow(item.evt, item.payload, item.ackCb);
            } catch {}
          }
          console.log("[SignalingClient] flushed outbox", queued.length);
        }
      },
    );

    return this.socket;
  }

  _emitNow(evt, payload, ackCb) {
    if (!this.socket) this.connect();

    const body = { room: this.room, payload };

    console.log("[SignalingClient] emit", evt, {
      room: this.room,
      hasPayload: !!payload,
      joined: this.joined,
      queued: this._outbox.length,
    });

    this.socket.emit(evt, body, (ack) => {
      console.log("[SignalingClient] ack", evt, ack);
      try {
        if (typeof ackCb === "function") ackCb(ack);
      } catch {}
    });
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

    // ✅ If join not completed yet, queue this signal
    if (!this.joined) {
      this._outbox.push({ evt, payload, ackCb });
      console.log("[SignalingClient] queued (not joined yet)", evt, {
        room: this.room,
        queued: this._outbox.length,
      });

      // make sure connect() has been called (it has), so join is in-flight
      return;
    }

    this._emitNow(evt, payload, ackCb);
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
    try {
      this._outbox.length = 0;
    } catch {}
    this.socket = null;
    this.joined = false;
    this.joining = false;
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
        err?.message || err,
      );
      return [
        {
          urls: ["stun:stun.l.google.com:19302"],
        },
      ];
    }
  }
}
