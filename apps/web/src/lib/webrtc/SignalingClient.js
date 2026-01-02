// apps/web/src/lib/webrtc/SignalingClient.js
// Tiny helper around Socket.IO just for WebRTC signaling

import { connectSocket, api } from "../api";

export default class SignalingClient {
  constructor(room, role = "caller") {
    this.room = room;
    this.role = role;
    this.socket = null;
    this.joined = false;
  }

// connect and join the call room (FIXED: wait for socket connection)
connect() {
  if (this.socket) return this.socket;

  this.socket = connectSocket();
  console.log("[SignalingClient] connect", {
    room: this.room,
    role: this.role,
  });

  const doJoin = () => {
    this.socket.emit(
      "room:join",
      { room: this.room, who: `call:${this.role}` },
      (ack) => {
        console.log("[SignalingClient] room:join ack", ack);
        this.joined = !!ack?.ok;
      }
    );
  };

  // 🔥 CRITICAL FIX: wait until the socket is actually connected
  if (this.socket.connected) {
    doJoin();
  } else {
    this.socket.once("connect", doJoin);
  }

  return this.socket;
}


  // listen for signaling events
  on(evt, handler) {
    if (!this.socket) this.connect();
    this.socket.on(evt, handler);
  }

  off(evt, handler) {
    if (!this.socket) return;
    if (handler) this.socket.off(evt, handler);
    else this.socket.off(evt);
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

    this.socket.emit("room:leave", { room: this.room });
    this.socket = null;
    this.joined = false;
  }

  // get ICE servers from backend
  static async getIceServers() {
    try {
      const res = await api.get("/webrtc/ice");
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
