// test-socket-verbose.js
// Verbose connectivity tester for your socket server.
// Usage: node test-socket-verbose.js "<ARG1>" "<ROOM>" "<TEXT>"

import axios from "axios";
import { io } from "socket.io-client";

const RAW_ARG = process.argv[2] || "";
const ROOM = process.argv[3] || "dm:uidA:uidB";
const TEXT = process.argv[4] || "hello from verbose test";

const SERVER_ROOT = process.env.SOCKET_URL || "http://localhost:8080";
const PATH = "/socket.io";

console.log("[verbose] checking HTTP reachability ->", SERVER_ROOT);

async function httpCheck() {
  try {
    const res = await axios.get(`${SERVER_ROOT}/api/health`, { timeout: 4000 });
    console.log("[verbose] HTTP reachable:", res.status, res.data ? res.data : "");
  } catch (e) {
    console.warn("[verbose] HTTP check failed:", e?.message || e);
  }
}

function looksLikeJwt(s) {
  return typeof s === "string" && s.split(".").length >= 2;
}

let auth = {};
let query = {};

if (RAW_ARG) {
  if (RAW_ARG.startsWith("uid:")) {
    query.uid = RAW_ARG.slice(4);
    console.log("[verbose] will use query.uid hint:", query.uid);
  } else if (RAW_ARG.toLowerCase().startsWith("bearer ")) {
    auth.Authorization = RAW_ARG;
    console.log("[verbose] will send auth.Authorization (Bearer) len:", RAW_ARG.length);
  } else if (looksLikeJwt(RAW_ARG)) {
    auth.token = RAW_ARG;
    console.log("[verbose] will send auth.token (JWT-like) len:", RAW_ARG.length);
  } else {
    auth.token = RAW_ARG;
    console.log("[verbose] will send auth.token (raw) len:", RAW_ARG.length);
  }
} else {
  console.log("[verbose] no auth arg provided");
}

await httpCheck();

// create socket with broader transports + longer timeouts
const socket = io(SERVER_ROOT, {
  path: PATH,
  transports: ["polling", "websocket"], // try polling first (more compatible), then websocket
  autoConnect: false,
  auth: () => auth,
  query,
  reconnectionAttempts: 5,
  timeout: 20000,
  upgrade: true,
});

// wire many events to see what's happening
socket.on("connect", () => {
  console.log("[verbose] socket connected, id:", socket.id);
  socket.emit("room:join", { room: ROOM }, (r) => {
    console.log("[verbose] room:join response:", r);
    socket.emit("chat:message", { room: ROOM, text: TEXT, meta: { verbose: true } }, (ack) => {
      console.log("[verbose] chat:message ack:", ack);
    });
  });
});

socket.on("connect_error", (err) => {
  console.warn("[verbose] connect_error:", err?.message || err);
  try {
    if (err?.data) console.warn("[verbose] connect_error.data:", err.data);
  } catch {}
});

socket.on("error", (e) => console.warn("[verbose] socket error:", e));
socket.on("reconnect_attempt", (n) => console.log("[verbose] reconnect_attempt:", n));
socket.on("reconnect_failed", () => console.warn("[verbose] reconnect_failed"));
socket.on("reconnect", (n) => console.log("[verbose] reconnected after attempts:", n));
socket.on("disconnect", (reason) => console.log("[verbose] disconnected:", reason));
socket.on("close", () => console.log("[verbose] socket close"));
socket.on("chat:message", (m) => console.log("[verbose] incoming chat:", m));
socket.on("dm:incoming", (d) => console.log("[verbose] dm incoming:", d));
socket.on("presence:join", (p) => console.log("[verbose] presence:join:", p));
socket.on("presence:leave", (p) => console.log("[verbose] presence:leave:", p));

console.log("[verbose] attempting connect...");
socket.connect();

// Give it time and then exit
setTimeout(() => {
  console.log("[verbose] timeout reached; disconnecting and exiting");
  try { socket.disconnect(); } catch {}
  setTimeout(() => process.exit(0), 300);
}, 45000);
