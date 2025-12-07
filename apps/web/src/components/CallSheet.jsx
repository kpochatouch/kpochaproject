// apps/web/src/components/CallSheet.jsx
import { useEffect, useRef, useState } from "react";
import SignalingClient from "../lib/webrtc/SignalingClient";
import { updateCallStatus } from "../lib/api";

/**
 * Props:
 * - room: signaling room string (e.g. "call:abc123")
 * - me: label for current user (for future UI)
 * - open: boolean (show/hide modal)
 * - onClose: () => void
 * - role: "caller" | "receiver"  (default "caller")
 * - callId: string | null        (optional but needed for status updates)
 * - callType: "audio" | "video"  (default "audio")
 * - peerName: string (name of the other person)
 * - peerAvatar: string (avatar URL of the other person)
 */
export default function CallSheet({
  room,
  me,
  open,
  onClose,
  role = "caller",
  callId = null,
  callType = "audio",
  peerName = "Kpocha Touch User",
  peerAvatar = "",
}) {
  const [sig, setSig] = useState(null);
  const [pc, setPc] = useState(null);
  const [mode, setMode] = useState(callType || "audio"); // "audio" | "video"
  const [starting, setStarting] = useState(false);
  const [hasConnected, setHasConnected] = useState(false);

  const localRef = useRef(null);
  const remoteRef = useRef(null);

  // 🔔 ring tones
  const callerToneRef = useRef(null); // for the person who is dialing
  const incomingToneRef = useRef(null); // for the person receiving

  // tiny helper to stop any ringing
  function stopAllTones() {
    [callerToneRef, incomingToneRef].forEach((ref) => {
      try {
        if (ref.current) {
          ref.current.pause();
          ref.current.currentTime = 0;
          ref.current = null;
        }
      } catch {}
    });
  }

  // keep mode in sync with callType when prop changes
  useEffect(() => {
    setMode(callType || "audio");
  }, [callType]);

  // setup signaling when modal opens
  useEffect(() => {
    if (!open || !room) return;

    const sc = new SignalingClient(
      room,
      role === "caller" ? "caller" : "receiver"
    );
    sc.connect();
    setSig(sc);

    // receiver: start incoming ringtone as soon as modal opens
    if (role !== "caller") {
      try {
        const audio = new Audio("/sound/incoming.mp3");
        audio.loop = true;
        incomingToneRef.current = audio;
        audio.play().catch(() => {});
      } catch {}
    }

    return () => {
      try {
        sc.disconnect();
      } catch {}
      setSig(null);
      stopAllTones();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, room, role]);

  // ---- helpers for peer connection + media ----

  async function setupPeerConnection(asCaller) {
    if (!sig || !room) return null;

    const wantVideo = mode === "video";

    // ✅ get ICE config from backend /api/webrtc/ice
    const iceServers = await SignalingClient.getIceServers();

    const pcNew = new RTCPeerConnection({ iceServers });
    setPc(pcNew);

    // local media: audio or audio+video
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: wantVideo,
    });
    stream.getTracks().forEach((t) => pcNew.addTrack(t, stream));
    if (localRef.current) localRef.current.srcObject = stream;

    // remote media
    pcNew.ontrack = (ev) => {
      if (remoteRef.current) remoteRef.current.srcObject = ev.streams[0];
    };

    // ICE
    pcNew.onicecandidate = (ev) => {
      if (ev.candidate) {
        try {
          sig.emit("webrtc:ice", ev.candidate);
        } catch (e) {
          console.warn("[CallSheet] emit ice failed:", e?.message || e);
        }
      }
    };

    pcNew.onconnectionstatechange = () => {
      const st = pcNew.connectionState;
      if (st === "connected") {
        setHasConnected(true);
        // once connected, stop any ringing on both sides
        stopAllTones();
      }
      if (["disconnected", "failed", "closed"].includes(st)) {
        // optional: you could auto-clean here
      }
    };

    // signaling listeners (shared for caller + receiver)
    sig.on("webrtc:offer", async (remoteSdp) => {
      try {
        await pcNew.setRemoteDescription(new RTCSessionDescription(remoteSdp));

        // receiver responds with answer
        if (!asCaller) {
          const answer = await pcNew.createAnswer();
          await pcNew.setLocalDescription(answer);
          sig.emit("webrtc:answer", answer);
        }
      } catch (e) {
        console.error("[CallSheet] handle offer failed:", e);
      }
    });

    sig.on("webrtc:answer", async (remoteSdp) => {
      try {
        if (asCaller) {
          await pcNew.setRemoteDescription(new RTCSessionDescription(remoteSdp));
        }
      } catch (e) {
        console.error("[CallSheet] handle answer failed:", e);
      }
    });

    sig.on("webrtc:ice", async (cand) => {
      try {
        await pcNew.addIceCandidate(cand);
      } catch (e) {
        console.warn("[CallSheet] addIceCandidate failed:", e?.message || e);
      }
    });

    // caller creates offer immediately
    if (asCaller) {
      const offer = await pcNew.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: wantVideo,
      });
      await pcNew.setLocalDescription(offer);
      sig.emit("webrtc:offer", offer);
    }

    return pcNew;
  }

  function cleanupPeer() {
    stopAllTones();

    try {
      if (pc) {
        pc.getSenders()?.forEach((s) => {
          try {
            s.track?.stop();
          } catch {}
        });
        pc.close();
      }
    } catch {}
    setPc(null);
    setHasConnected(false);

    try {
      sig?.disconnect();
    } catch {}
    setSig(null);

    // stop local media
    if (localRef.current?.srcObject) {
      try {
        localRef.current.srcObject.getTracks().forEach((t) => t.stop());
      } catch {}
      localRef.current.srcObject = null;
    }
    if (remoteRef.current?.srcObject) {
      try {
        remoteRef.current.srcObject.getTracks().forEach((t) => t.stop());
      } catch {}
      remoteRef.current.srcObject = null;
    }
  }

  async function safeUpdateStatus(status, meta = {}) {
    if (!callId || !status) return;
    try {
      await updateCallStatus({ callId, status, meta });
    } catch (e) {
      console.warn("[CallSheet] updateCallStatus failed:", e?.message || e);
    }
  }

  // ---- caller actions ----

  async function startCaller() {
    if (!sig || !room) return;
    setStarting(true);
    try {
      // start caller ring tone when we actually dial
      if (!callerToneRef.current) {
        try {
          const audio = new Audio("/sound/caller-tune.mp3");
          audio.loop = true;
          callerToneRef.current = audio;
          audio.play().catch(() => {});
        } catch {}
      }

      await setupPeerConnection(true);
      // optional: mark as "ringing"
      await safeUpdateStatus("ringing");
    } catch (e) {
      console.error("call start error:", e);
      alert("Could not start call. Check your microphone/camera permissions.");
      stopAllTones();
    } finally {
      setStarting(false);
    }
  }

  // ---- receiver actions ----

  async function acceptIncoming() {
    if (!sig || !room) return;
    setStarting(true);
    try {
      // stop ringtone once user accepts
      stopAllTones();
      await safeUpdateStatus("accepted");
      await setupPeerConnection(false); // wait for caller's offer
    } catch (e) {
      console.error("accept call failed:", e);
      alert("Could not accept call. Check your microphone/camera permissions.");
      // if it fails, mark declined
      await safeUpdateStatus("declined", { reason: "media_error" });
      cleanupPeer();
      onClose?.();
    } finally {
      setStarting(false);
    }
  }

  async function declineIncoming() {
    stopAllTones();
    await safeUpdateStatus("declined");
    cleanupPeer();
    onClose?.();
  }

  // ---- hangup (both roles) ----

  async function hangup() {
    stopAllTones();
    // pick status depending on whether call ever connected
    const endedStatus =
      hasConnected ? "ended" : role === "caller" ? "cancelled" : "declined";

    await safeUpdateStatus(endedStatus);
    cleanupPeer();
    onClose?.();
  }

  // ---------- render ----------

  if (!open || !room) return null;

  const isCaller = role === "caller";
  const isReceiver = !isCaller;

  // Status line like WhatsApp: Calling / Incoming / Connected
  let statusText = "";
  if (hasConnected) {
    statusText = "Connected";
  } else if (starting) {
    statusText = "Connecting…";
  } else {
    statusText = isCaller ? "Calling…" : "Incoming call";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="relative w-full max-w-xl h-full md:h-[520px] md:rounded-2xl md:overflow-hidden bg-[#111] border border-zinc-800">

        {/* top bar – similar to WhatsApp desktop */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-black/60">
          <div className="flex flex-col">
            <span className="text-xs text-zinc-400 uppercase tracking-[0.15em]">
              Kpocha Touch
            </span>
            <span className="text-[11px] text-emerald-400">
              End-to-end encrypted
            </span>
          </div>
          <button
            className="text-xs px-3 py-1 rounded-full border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            onClick={hangup}
            type="button"
          >
            Close
          </button>
        </div>

        {/* main content area */}
        <div className="relative flex-1 flex flex-col items-center justify-center px-6 py-10 overflow-hidden">

          {/* VIDEO MODE: remote as big view, local as small floating preview */}
          {mode === "video" && (
            <>
              <video
                ref={remoteRef}
                autoPlay
                playsInline
                className="absolute inset-0 w-full h-full object-cover opacity-80"
              />
              <div className="absolute inset-0 bg-black/40" />
              <video
                ref={localRef}
                autoPlay
                playsInline
                muted
                className="absolute bottom-24 right-4 w-28 h-40 rounded-2xl border border-zinc-300 shadow-lg object-cover bg-black"
              />
            </>
          )}

          {/* AUDIO MODE: static avatar centre (no visible video) */}
          {mode === "audio" && (
            <div className="flex flex-col items-center">
              <div className="w-32 h-32 rounded-full mb-4 border-4 border-emerald-500/60 shadow-[0_0_40px_rgba(16,185,129,0.4)] flex items-center justify-center overflow-hidden bg-zinc-900">
                {peerAvatar ? (
                  <img
                    src={peerAvatar}
                    alt={peerName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-3xl text-emerald-400">
                    {peerName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* hidden media elements for audio mode so sound still plays */}
          {mode === "audio" && (
            <div className="w-0 h-0 overflow-hidden">
              <video ref={localRef} autoPlay playsInline muted />
              <video ref={remoteRef} autoPlay playsInline />
            </div>
          )}

          {/* centred name + status label */}
          <div className="relative z-10 flex flex-col items-center gap-1 mt-4">
            <span className="text-lg md:text-2xl font-semibold text-zinc-50">
              {peerName}
            </span>
            <span className="text-sm text-zinc-300 mt-1">
              {statusText}
            </span>
            <span className="text-[11px] text-zinc-500 mt-1">
              {mode === "audio" ? "Voice call" : "Video call"}
              {isCaller ? " • You are calling" : " • Incoming"}
            </span>
          </div>
        </div>

        {/* bottom controls – WhatsApp-style icons */}
        <div className="px-8 pb-8 pt-4 bg-black/70 border-t border-zinc-800 flex flex-col gap-4">
          <div className="flex items-center justify-center gap-4">
            {isCaller ? (
              <>
                <button
                  className="flex-1 max-w-[180px] px-4 py-2 rounded-full bg-zinc-800 text-zinc-100 text-sm font-medium disabled:opacity-50"
                  onClick={startCaller}
                  disabled={starting}
                  type="button"
                >
                  {starting
                    ? "Connecting…"
                    : mode === "audio"
                    ? "Start audio call"
                    : "Start video call"}
                </button>
                <button
                  className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-600 text-white shadow-lg"
                  onClick={hangup}
                  type="button"
                >
                  ⛔
                </button>
              </>
            ) : !pc ? (
              <>
                <button
                  className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500 text-black font-bold shadow-lg disabled:opacity-50"
                  onClick={acceptIncoming}
                  disabled={starting}
                  type="button"
                >
                  ✓
                </button>
                <button
                  className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-600 text-white shadow-lg"
                  onClick={declineIncoming}
                  type="button"
                >
                  ✕
                </button>
              </>
            ) : (
              <button
                className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-600 text-white shadow-lg mx-auto"
                onClick={hangup}
                type="button"
              >
                ⛔
              </button>
            )}
          </div>

          {/* extra fake icons row – mute / speaker / chat, like WhatsApp */}
          <div className="flex items-center justify-center gap-6 text-zinc-400 text-xl">
            <button type="button" className="hover:text-zinc-100">🎙</button>
            <button type="button" className="hover:text-zinc-100">🔊</button>
            <button type="button" className="hover:text-zinc-100">💬</button>
          </div>
        </div>
      </div>
    </div>
  );
}
