// apps/web/src/components/CallSheet.jsx
import { useEffect, useRef, useState } from "react";
import SignalingClient from "../lib/webrtc/SignalingClient";
import { updateCallStatus, sendChatMessage } from "../lib/api";

/**
 * Props:
 * - room: signaling room string (e.g. "call:abc123")
 * - me: label for current user
 * - open: boolean (show/hide modal)
 * - onClose: () => void
 * - role: "caller" | "receiver"  (default "caller")
 * - callId: string | null
 * - callType: "audio" | "video"  (default "audio")
 * - peerName: string
 * - peerAvatar: string
 */
export default function CallSheet({
  room,
  me,
  open,
  onClose,
  role = "caller",
  callId = null,
  callType = "audio",
  peerName = "",
  peerAvatar = "",
  chatRoom = null,
}) {
  const [sig, setSig] = useState(null);
  const [pc, setPc] = useState(null);
  const [mode, setMode] = useState(callType || "audio");
  const [starting, setStarting] = useState(false);
  const [hasConnected, setHasConnected] = useState(false);
  const [hasAccepted, setHasAccepted] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);

  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(mode === "audio");

  // ⏱ call duration state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const localRef = useRef(null);
  const remoteRef = useRef(null);

  // ring tones
  const callerToneRef = useRef(null);
  const incomingToneRef = useRef(null);

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

  // helper: format seconds as mm:ss
  function formatDuration(sec) {
    if (!sec || sec <= 0) return "00:00";
    const minutes = Math.floor(sec / 60);
    const seconds = sec % 60;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return `${mm}:${ss}`;
  }
  // 🔔 Send call summary into chat (for call bubble)
  async function sendCallSummaryMessage(status) {
    if (!chatRoom) return; // nothing to do if no room passed

    const callMeta = {
      type: callType || (mode === "video" ? "video" : "audio"),
      status, // "ended" | "cancelled" | "declined"
      hasConnected,
      durationSec: hasConnected ? elapsedSeconds : 0,
    };

    try {
      await sendChatMessage({
        room: chatRoom,
        text: "",
        meta: { call: callMeta },
      });
    } catch (e) {
      console.warn("[CallSheet] sendCallSummaryMessage failed:", e?.message || e);
    }
  }


  // keep mode in sync with callType when prop changes
  useEffect(() => {
    setMode(callType || "audio");
    setCamOff(callType === "audio");
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

    if (role !== "caller") {
      // incoming side: start ringtone immediately
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
      setAutoStarted(false);
      setElapsedSeconds(0); // reset duration when modal closes
      setHasAccepted(false); // 👈 reset accept state
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, room, role]);

  // ⏱ duration timer: start counting only when connected
  useEffect(() => {
    if (!open) {
      setElapsedSeconds(0);
      return;
    }
    if (!hasConnected) return;

    const id = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(id);
  }, [open, hasConnected]);

  async function setupPeerConnection(asCaller) {
    if (!sig || !room) return null;

    const wantVideo = mode === "video" && !camOff;

    const iceServers = await SignalingClient.getIceServers();

    const pcNew = new RTCPeerConnection({ iceServers });
    setPc(pcNew);

    // local media
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
        // only run once per call
        setHasConnected((prev) => {
          if (!prev) {
            stopAllTones();
            safeUpdateStatus("accepted", {
              connectedAt: new Date().toISOString(),
            });
          }
          return true;
        });
      }
      if (["disconnected", "failed", "closed"].includes(st)) {
        setHasConnected(false); // 👈 not connected anymore
      }
    };

    // signaling listeners
    sig.on("webrtc:offer", async (msg) => {
      try {
        const remoteSdp = msg?.payload || msg; // unwrap payload
        await pcNew.setRemoteDescription(new RTCSessionDescription(remoteSdp));
        if (!asCaller) {
          const answer = await pcNew.createAnswer();
          await pcNew.setLocalDescription(answer);
          sig.emit("webrtc:answer", answer);
        }
      } catch (e) {
        console.error("[CallSheet] handle offer failed:", e);
      }
    });

    sig.on("webrtc:answer", async (msg) => {
      try {
        if (asCaller) {
          const remoteSdp = msg?.payload || msg; // unwrap payload
          await pcNew.setRemoteDescription(
            new RTCSessionDescription(remoteSdp)
          );
        }
      } catch (e) {
        console.error("[CallSheet] handle answer failed:", e);
      }
    });

    sig.on("webrtc:ice", async (msg) => {
      try {
        const cand = msg?.payload || msg; // unwrap payload
        if (cand) {
          await pcNew.addIceCandidate(cand);
        }
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
    setHasAccepted(false); // 👈 reset accept state
    setElapsedSeconds(0); // reset duration when call ends

    try {
      sig?.disconnect();
    } catch {}
    setSig(null);

    // stop local & remote streams
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

  // ---- caller: start as soon as sheet opens ----
  async function startCaller() {
    if (!sig || !room) return;
    setStarting(true);
    try {
      if (!callerToneRef.current) {
        try {
          const audio = new Audio("/sound/caller-tune.mp3");
          audio.loop = true;
          callerToneRef.current = audio;
          audio.play().catch(() => {});
        } catch {}
      }

      await setupPeerConnection(true);
      await safeUpdateStatus("ringing");
    } catch (e) {
      console.error("call start error:", e);
      alert(
        "Could not start call. Please check microphone/camera permissions."
      );
      stopAllTones();
    } finally {
      setStarting(false);
    }
  }

  // auto-start caller once signaling client is ready
  useEffect(() => {
    if (!open || !room) return;
    if (role !== "caller") return;
    if (autoStarted) return;
    if (!sig) return; // wait until signaling is ready
    startCaller();
    setAutoStarted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, room, role, sig, autoStarted]);

  // ---- receiver actions ----

    async function acceptIncoming() {
    if (!sig || !room) return;
    setStarting(true);
    try {
      stopAllTones();
      setHasAccepted(true);              // 👈 receiver has accepted
      await safeUpdateStatus("accepted");
      await setupPeerConnection(false);

    } catch (e) {
      console.error("accept call failed:", e);
      alert(
        "Could not accept call. Please check microphone/camera permissions."
      );
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
    await sendCallSummaryMessage("declined");
    cleanupPeer();
    onClose?.();
  }

  // ---- hangup (both roles) ----

  async function hangup() {
    stopAllTones();
    const endedStatus =
      hasConnected ? "ended" : role === "caller" ? "cancelled" : "declined";

    await safeUpdateStatus(endedStatus);
    await sendCallSummaryMessage(endedStatus);
    cleanupPeer();
    onClose?.();
  }

  // ---- mic / camera toggles ----

  function toggleMic() {
    const stream = localRef.current?.srcObject;
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    audioTracks.forEach((t) => {
      t.enabled = !t.enabled;
      setMicMuted(!t.enabled);
    });
  }

  function toggleCam() {
    const stream = localRef.current?.srcObject;
    if (!stream) return;
    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length) return;
    videoTracks.forEach((t) => {
      t.enabled = !t.enabled;
      setCamOff(!t.enabled);
    });
  }

  // ---------- render ----------

  if (!open || !room) return null;

    const isCaller = role === "caller";

  // WhatsApp-like status text
  let statusText = "";
  if (hasConnected) {
    statusText = "Connected";
  } else if (starting) {
    statusText = "Connecting…";
  } else if (!isCaller && hasAccepted) {
    // receiver has tapped Accept but WebRTC not fully connected yet
    statusText = "Connecting…";
  } else {
    statusText = isCaller ? "Calling…" : "Incoming call";
  }

  const displayPeerName =
    peerName && peerName.trim().length ? peerName : "Unknown user";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="relative w-full max-w-xl h-full md:h-[520px] md:rounded-2xl md:overflow-hidden bg-[#111] border border-zinc-800">
        {/* top bar */}
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

        {/* main content */}
        <div className="relative flex-1 flex flex-col items-center justify-center px-6 py-10 overflow-hidden">
          {/* video layout */}
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

          {/* audio layout */}
          {mode === "audio" && (
            <div className="flex flex-col items-center">
              <div className="w-32 h-32 rounded-full mb-4 border-4 border-emerald-500/60 shadow-[0_0_40px_rgba(16,185,129,0.4)] flex items-center justify-center overflow-hidden bg-zinc-900">
                {peerAvatar ? (
                  <img
                    src={peerAvatar}
                    alt={displayPeerName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-3xl text-emerald-400">
                    {displayPeerName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              {/* hidden video tags so audio tracks still attach */}
              <div className="w-0 h-0 overflow-hidden">
                <video ref={localRef} autoPlay playsInline muted />
                <video ref={remoteRef} autoPlay playsInline />
              </div>
            </div>
          )}

          {/* centre text */}
          <div className="relative z-10 flex flex-col items-center gap-1 mt-4">
            <span className="text-lg md:text-2xl font-semibold text-zinc-50">
             {displayPeerName}
            </span>

            {/* show duration once connected, otherwise show status text */}
            <span className="text-sm text-zinc-300 mt-1">
              {hasConnected ? formatDuration(elapsedSeconds) : statusText}
            </span>

            <span className="text-[11px] text-zinc-500 mt-1">
              {mode === "audio" ? "Voice call" : "Video call"} •{" "}
              {isCaller ? "You are calling" : "Incoming"}
            </span>
          </div>
        </div>

          {/* bottom controls */}
            <div className="px-8 pb-8 pt-4 bg-black/70 border-t border-zinc-800 flex flex-col gap-4">
              {/* accept / decline for receiver (before connected), hangup otherwise */}
              <div className="flex items-center justify-center gap-6">
                {/* Receiver, not yet connected → show Accept / Decline */}
                {!isCaller && !hasConnected ? (
                  <>
                    {/* Decline on the left (red phone) */}
                    <button
                      className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-600 text-white text-xl shadow-lg"
                      onClick={declineIncoming}
                      type="button"
                    >
                      📞
                    </button>

                    {/* Center handset (slider-style look, no action) */}
                    <button
                      className="flex items-center justify-center w-12 h-12 rounded-full bg-zinc-800 text-zinc-200 text-xl shadow-inner"
                      type="button"
                      disabled
                    >
                      📞
                    </button>

                    {/* Accept on the right (green phone) */}
                    <button
                      className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500 text-black text-xl shadow-lg disabled:opacity-50"
                      onClick={acceptIncoming}
                      disabled={starting}
                      type="button"
                    >
                      📞
                    </button>
                  </>
                ) : (
                  // Caller or already-connected receiver → single red hangup
                  <button
                    className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-600 text-white text-xl shadow-lg mx-auto"
                    onClick={hangup}
                    type="button"
                  >
                    📞
                  </button>
                )}
              </div>



          {/* real mic / camera / chat buttons */}
          <div className="flex items-center justify-center gap-6 text-zinc-400 text-xl">
            {/* mic */}
            <button
              type="button"
              onClick={toggleMic}
              className={`hover:text-zinc-100 ${
                micMuted ? "text-rose-400" : ""
              }`}
            >
              {micMuted ? "🔇" : "🎙"}
            </button>

            {/* camera (only meaningful for video) */}
            {mode === "video" && (
              <button
                type="button"
                onClick={toggleCam}
                className={`hover:text-zinc-100 ${
                  camOff ? "text-rose-400" : ""
                }`}
              >
                {camOff ? "📷✕" : "📷"}
              </button>
            )}

            {/* chat shortcut: just closes sheet for now */}
            <button
              type="button"
              onClick={onClose}
              className="hover:text-zinc-100"
              title="Back to chat"
            >
              💬
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
