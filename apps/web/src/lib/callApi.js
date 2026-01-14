// apps/web/src/lib/callApi.js
// Thin WebRTC / media helpers for call flow.
// Depends on: SignalingClient (optional), and api.js helpers (emitWebRTC, initiateCall, updateCallStatus)

import SignalingClient from "./webrtc/SignalingClient.js"; // relative to your repo
import { api, initiateCall, updateCallStatus, emitWebRTC } from "./api";

/**
 * Defaults
 */
const DEFAULT_CONSTRAINTS = { audio: true, video: true };

/* ---------- Media helpers ---------- */
export async function getLocalMedia(constraints = DEFAULT_CONSTRAINTS) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;
  } catch (err) {
    throw new Error(err?.message || "getUserMedia_failed");
  }
}

export async function listDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices;
  } catch {
    return [];
  }
}

export function stopMediaStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {}
  });
}

/* ---------- PeerConnection factory ---------- */
export async function createPeerConnection({
  iceServers = [],
  onTrack = () => {},
  onIceCandidate = () => {},
  onConnectionStateChange = () => {},
  config = {},
} = {}) {
  const pc = new RTCPeerConnection({ iceServers, ...config });

  pc.ontrack = (ev) => {
    // ev.streams[0] is the typical remote stream
    onTrack(ev);
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate) onIceCandidate(ev.candidate);
  };

  pc.onconnectionstatechange = () => {
    onConnectionStateChange(pc.connectionState);
  };

  return pc;
}

/* ---------- Utility: attach / detach local tracks ---------- */
export function attachLocalStreamToPeer(pc, localStream) {
  if (!pc || !localStream) return;
  // remove previously added senders if changing stream
  const existingSenders = pc.getSenders?.() || [];
  // naive approach: remove audio/video senders then replace
  localStream.getTracks().forEach((track) => {
    // prefer replacing existing sender with same kind
    const sender = existingSenders.find((s) => s.track?.kind === track.kind);
    if (sender && sender.replaceTrack) {
      sender.replaceTrack(track).catch(() => {});
    } else {
      try {
        pc.addTrack(track, localStream);
      } catch {}
    }
  });
}

export function removeLocalSenders(pc) {
  if (!pc) return;
  pc.getSenders?.().forEach((s) => {
    try {
      if (s.track) s.track.stop?.();
      pc.removeTrack?.(s);
    } catch {}
  });
}

/* ---------- High-level flow helpers ---------- */

/**
 * startOutgoingCall
 * tries to initiate via socket (api.initiateCall) — returns server record
 * also gives you a SignalingClient (for webrtc messages) optionally
 */
export async function startOutgoingCall({
  receiverUid,
  callType = "video",
  localStream = null,
  useSignalingClient = true,
  room = null,
  callId = null,
} = {}) {
  if (!receiverUid) throw new Error("receiverUid required");

  // call record on server
  const ack = await initiateCall({
    receiverUid,
    callType,
    meta: {},
    room,
    callId,
  });

  // ack should contain room & callId (server-created)
  const { room: callRoom, callId: serverCallId } = ack;

  // optionally attach SignalingClient (useful when joining booking:<id> rooms)
  let signaling = null;
  if (useSignalingClient) {
    signaling = new SignalingClient(callRoom, "caller");
  }

  return { record: ack, signaling, callRoom, callId: serverCallId || callId };
}

/**
 * updateCall - wrapper for change status
 */
export async function updateCall({
  id = null,
  callId = null,
  status,
  meta = {},
} = {}) {
  return updateCallStatus({ id, callId, status, meta });
}

/* ---------- Export simple helpers for UI toggle ---------- */
export function toggleTrackEnabled(stream, kind = "audio") {
  if (!stream) return;
  const track = stream.getTracks().find((t) => t.kind === kind);
  if (!track) return false;
  track.enabled = !track.enabled;
  return track.enabled;
}

export async function startScreenShare() {
  try {
    // prefer displayMedia
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
    return s;
  } catch (err) {
    throw new Error(err?.message || "screen_share_failed");
  }
}
