import { useEffect, useRef, useState } from "react";
import SignalingClient from "../lib/webrtc/SignalingClient";
import { updateCallStatus, sendChatMessage, registerSocketHandler } from "../lib/api";

/**
 * STABLE CALLSHEET
 * - PeerConnection is stored in useRef (NOT useState)
 * - React NEVER closes WebRTC implicitly
 * - Only hangup()/decline() end the call
 */

export default function CallSheet({
  room,
  open,
  onClose,
  role = "caller",
  callId = null,
  callType = "audio",
  peerName = "",
  peerAvatar = "",
  chatRoom = null,
}) {
  /* ---------- refs (stable across renders) ---------- */
  const pcRef = useRef(null);
  const sigRef = useRef(null);
  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const callerToneRef = useRef(null);
  const incomingToneRef = useRef(null);

  /* ---------- state (UI only) ---------- */
  const [mode, setMode] = useState(callType || "audio");
  const [starting, setStarting] = useState(false);
  const [hasConnected, setHasConnected] = useState(false);
  const [hasAccepted, setHasAccepted] = useState(false);
  const [peerAccepted, setPeerAccepted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [callFailed, setCallFailed] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(callType === "audio");

  /* ---------- helpers ---------- */
  function stopAllTones() {
    [callerToneRef, incomingToneRef].forEach((r) => {
      try {
        r.current?.pause();
        if (r.current) r.current.currentTime = 0;
      } catch {}
      r.current = null;
    });
  }

  function formatDuration(sec) {
    if (!sec) return "00:00";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  async function sendCallSummary(status) {
    if (!chatRoom) return;
    try {
      await sendChatMessage({
        room: chatRoom,
        text: "",
        meta: {
          call: {
            type: mode,
            status,
            hasConnected,
            durationSec: hasConnected ? elapsedSeconds : 0,
          },
        },
      });
    } catch {}
  }

  async function safeUpdateStatus(status, meta = {}) {
    if (!callId) return;
    try {
      await updateCallStatus({ callId, status, meta });
    } catch {}
  }

  /* ---------- signaling setup (ONCE per open) ---------- */
  useEffect(() => {
    if (!open || !room || sigRef.current) return;

    const sig = new SignalingClient(room, role);
    sig.connect();
    sigRef.current = sig;

    if (role === "receiver") {
      const a = new Audio("/sound/incoming.mp3");
      a.loop = true;
      incomingToneRef.current = a;
      a.play().catch(() => {});
    }

    return () => {
      // DO NOT CLOSE PC HERE
      stopAllTones();
    };
  }, [open, room, role]);

  /* ---------- backend call lifecycle ---------- */
  useEffect(() => {
    if (!open || !callId) return;

    return registerSocketHandler("call:status", (evt) => {
      if (evt?.callId !== callId) return;

      if (evt.status === "accepted") {
        stopAllTones();
        setPeerAccepted(true);
      }

      if (["ended", "declined", "cancelled", "failed", "missed"].includes(evt.status)) {
        finalize(evt.status);
      }
    });
  }, [open, callId]);

  /* ---------- create peer connection (EXPLICIT) ---------- */
  async function ensurePeerConnection(asCaller) {
    if (pcRef.current) return pcRef.current;

    const iceServers = await SignalingClient.getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    pc.ontrack = (e) => {
      if (remoteRef.current) remoteRef.current.srcObject = e.streams[0];
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) sigRef.current?.emit("webrtc:ice", e.candidate);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        stopAllTones();
        setHasConnected(true);
        safeUpdateStatus("accepted");
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: mode === "video" && !camOff,
    });

    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    if (localRef.current) localRef.current.srcObject = stream;

    sigRef.current.on("webrtc:offer", async ({ payload }) => {
      if (!pcRef.current) return;
      await pc.setRemoteDescription(payload);
      if (!asCaller) {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sigRef.current.emit("webrtc:answer", answer);
      }
    });

    sigRef.current.on("webrtc:answer", async ({ payload }) => {
      if (asCaller && pcRef.current) {
        await pc.setRemoteDescription(payload);
        stopAllTones();
        setPeerAccepted(true);
      }
    });

    sigRef.current.on("webrtc:ice", async ({ payload }) => {
      try {
        await pcRef.current?.addIceCandidate(payload);
      } catch {}
    });

    if (asCaller) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sigRef.current.emit("webrtc:offer", offer);
    }

    return pc;
  }

  /* ---------- call actions ---------- */
  async function startCaller() {
    setStarting(true);
    callerToneRef.current = new Audio("/sound/caller-tune.mp3");
    callerToneRef.current.loop = true;
    callerToneRef.current.play().catch(() => {});
    await ensurePeerConnection(true);
    await safeUpdateStatus("ringing");
    setStarting(false);
  }

  async function acceptIncoming() {
    stopAllTones();
    setHasAccepted(true);
    await ensurePeerConnection(false);
    await safeUpdateStatus("accepted");
  }

  async function hangup() {
    const status = hasConnected ? "ended" : role === "caller" ? "cancelled" : "declined";
    await safeUpdateStatus(status);
    await sendCallSummary(status);
    finalize(status);
  }

  function finalize() {
    stopAllTones();

    try {
      pcRef.current?.getSenders().forEach((s) => s.track?.stop());
      pcRef.current?.close();
    } catch {}

    pcRef.current = null;
    sigRef.current?.disconnect();
    sigRef.current = null;

    setElapsedSeconds(0);
    setHasConnected(false);
    setHasAccepted(false);
    setPeerAccepted(false);

    onClose?.();
  }

  /* ---------- timers ---------- */
  useEffect(() => {
    if (!hasConnected) return;
    const id = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [hasConnected]);

  /* ---------- auto-start ---------- */
  useEffect(() => {
    if (open && role === "caller" && sigRef.current && !pcRef.current) {
      startCaller();
    }
  }, [open, role]);

  /* ---------- UI ---------- */
  if (!open) return null;
  const statusText = callFailed
    ? "Call failed"
    : hasConnected
    ? formatDuration(elapsedSeconds)
    : "Connecting…";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="relative w-full max-w-xl bg-[#111] border border-zinc-800">
        <div className="p-3 flex justify-between">
          <span>{peerName || "Call"}</span>
          <button onClick={hangup}>End</button>
        </div>

        <div className="h-[420px] flex items-center justify-center text-white">
          {mode === "video" ? (
            <>
              <video ref={remoteRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
              <video ref={localRef} autoPlay muted playsInline className="absolute bottom-4 right-4 w-32" />
            </>
          ) : (
            <div>
              <div>{statusText}</div>
              <video ref={localRef} autoPlay muted className="hidden" />
              <video ref={remoteRef} autoPlay className="hidden" />
            </div>
          )}
        </div>

        {!hasConnected && role === "receiver" && (
          <div className="flex justify-center gap-6 p-4">
            <button onClick={hangup}>Decline</button>
            <button onClick={acceptIncoming}>Accept</button>
          </div>
        )}
      </div>
    </div>
  );
}
