// apps/web/src/lib/webrtc/SignalingClient.js
import { io } from "socket.io-client";

export default class SignalingClient {
  constructor(room, who = "client", opts = {}) {
    this.room = String(room || "").trim();
    this.who = who || "client";
    this.opts = opts || {};

    // env detection: prefer explicit VITE_SOCKET_URL or fallback to base url
    const raw =
      import.meta.env.VITE_SOCKET_URL ||
      import.meta.env.VITE_API_BASE_URL ||
      window.location.origin;
    let url = String(raw || window.location.origin).trim().replace(/\/+$/, "");
    if (/\/api$/i.test(url)) url = url.replace(/\/api$/i, "");

    this._buildSocket(url);
    this.handlers = {};
    this.connected = false;

    // token change wiring (optional)
    if (typeof opts.onTokenChange === "function") {
      this._onTokenChange = opts.onTokenChange;
      // caller may call the supplied callback to receive a refresh function:
      // opts.onTokenChange((newToken) => sc.refreshAuth(newToken))
      this._onTokenChange((t) => this.refreshAuth(t));
    }
  }

  _getAuthPayload() {
    try {
      if (typeof this.opts.tokenGetter === "function") {
        const t = this.opts.tokenGetter();
        if (t) return { token: t };
      }
      const t = localStorage.getItem("token");
      if (t) return { token: t };
    } catch (e) {}
    return {};
  }

  _buildSocket(url) {
    const opts = {
      transports: ["websocket", "polling"],
      path: "/socket.io",
      autoConnect: false, // explicit connect via sc.connect()
      auth: () => this._getAuthPayload(),
      ...this.opts.socketOpts,
    };

    this.socket = io(url, opts);

    this.socket.on("connect", () => {
      this.connected = true;
      try {
        // join room (best-effort). server handler should accept { room, who }
        this.socket.emit(
          "room:join",
          { room: this.room, who: this.who },
          (ack) => {
            if (!ack || !ack.ok) {
              if (this.handlers["room:join:fail"]) {
                this._emitLocal("room:join:fail", ack);
              }
            } else {
              this._emitLocal("room:join", ack);
            }
          }
        );
      } catch (e) {
        // swallow
      }
    });

    this.socket.on("disconnect", (reason) => {
      this.connected = false;
      this._emitLocal("disconnect", reason);
    });

    this.socket.on("connect_error", (err) => {
      this._emitLocal("connect_error", err);
    });

    // wire webrtc events to local handlers
    ["webrtc:offer", "webrtc:answer", "webrtc:ice"].forEach((evt) => {
      this.socket.on(evt, (payload) => {
        this._emitLocal(evt, payload);
      });
    });
  }

  // allow external token refresh: replace auth object and reconnect if needed
  refreshAuth(newToken) {
    try {
      if (!this.socket) return;
      if (newToken) {
        this.socket.auth = () => ({ token: newToken });
      } else {
        this.socket.auth = () => this._getAuthPayload();
      }
      if (!this.socket.connected) {
        this.socket.connect();
      }
    } catch (e) {}
  }

  /**
   * getIceServers
   *
   * Flow:
   * 1) Try backend: GET /api/webrtc/ice (production recommended)
   * 2) If backend fails, use Google STUN fallback (safe, no credentials)
   *
   * Dev note: if you want local dev env fallbacks, set VITE_STUN_URLS / VITE_TURN_URLS
   * but do NOT put TURN credentials (VITE_TURN_USERNAME / VITE_TURN_PASSWORD) in production Vercel.
   */
    static async getIceServers() {
    // Build root exactly like other API clients: strip trailing slashes and /api
    let root =
      (import.meta.env.VITE_API_BASE_URL ||
        import.meta.env.VITE_API_BASE ||
        window.location.origin)
        .toString()
        .trim();

    root = root.replace(/\/+$/, "");
    if (/\/api$/i.test(root)) {
      root = root.replace(/\/api$/i, "");
    }

    const url = `${root}/api/webrtc/ice`;

    try {
          const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();

      // 🔍 ADD THIS BLOCK
      if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
        console.log("[getIceServers] using backend ICE:", data.iceServers);
        return data.iceServers;
      }
      // 🔍 END ADDED BLOCK

    } else {
      try {
        const text = await res.text();
        console.warn(
          "[getIceServers] server returned non-ok:",
          res.status,
          text
        );
      } catch (e) {
        console.warn(
          "[getIceServers] server returned non-ok status:",
          res.status
        );
      }
    }
    } catch (e) {
      console.warn("[getIceServers] fetch failed:", e?.message || e);
    }

    // Fallback: Google STUN (safe, no credentials)
    console.warn("[getIceServers] falling back to Google STUN (public).");
    return [
      {
        urls: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302",
        ],
      },
    ];
  }


  on(evt, fn) {
    if (!evt || typeof fn !== "function") return;
    this.handlers[evt] = this.handlers[evt] || [];
    this.handlers[evt].push(fn);
  }

  off(evt, fn) {
    if (!evt) return;
    if (!this.handlers[evt]) return;
    if (!fn) {
      delete this.handlers[evt];
      return;
    }
    this.handlers[evt] = this.handlers[evt].filter((f) => f !== fn);
  }

  _emitLocal(evt, payload) {
    (this.handlers[evt] || []).forEach((h) => {
      try {
        h(payload);
      } catch (e) {
        console.warn("[SignalingClient] handler error", e?.message || e);
      }
    });
  }

  // wrapper for server-side events; includes `from` for backward compatibility
  emit(evt, payload) {
    if (!this.socket) return;
    try {
      this.socket.emit(
        evt,
        { room: this.room, from: this.who, payload },
        (ack) => {
          this._emitLocal(`${evt}:ack`, ack);
        }
      );
    } catch (e) {
      console.warn("[SignalingClient] emit failed", e?.message || e);
    }
  }

  connect() {
    try {
      if (!this.socket) this._buildSocket();
      if (!this.socket.connected) this.socket.connect();
    } catch (e) {
      console.warn("[SignalingClient] connect failed", e?.message || e);
    }
  }

  disconnect() {
    try {
      if (!this.socket) return;
      ["connect", "disconnect", "connect_error"].forEach((ev) =>
        this.socket.off(ev)
      );
      ["webrtc:offer", "webrtc:answer", "webrtc:ice"].forEach((ev) =>
        this.socket.off(ev)
      );
      this.socket.disconnect();
      this.handlers = {};
      this.socket = null;
      this.connected = false;
    } catch (e) {
      // ignore
    }
  }
}
