// apps/web/src/components/CallSheet.jsx
import { useEffect, useRef, useState } from "react";
import SignalingClient from "../lib/webrtc/SignalingClient";
import {
  updateCallStatus,
  sendChatMessage,
  registerSocketHandler,
} from "../lib/api";


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
  const [peerAccepted, setPeerAccepted] = useState(false);
  const [peerStatus, setPeerStatus] = useState(null);

  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(mode === "audio");

  // ⏱ call duration state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // ❌ call failed state (when accepted but never connects)
  const [callFailed, setCallFailed] = useState(false);

  const [pipFlipped, setPipFlipped] = useState(false);
  const [isMini, setIsMini] = useState(false);


  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const pcRef = useRef(null);

  // 🔆 Keep screen awake during calls (mobile)
const wakeLockRef = useRef(null);

async function requestWakeLock() {
  try {
    if (!("wakeLock" in navigator)) return false;

    wakeLockRef.current = await navigator.wakeLock.request("screen");

    // 👇 NEW: detect if the system releases it
    wakeLockRef.current.addEventListener("release", () => {
      console.log("[WakeLock] released by system");
    });

    return true;
  } catch {
    return false;
  }
}


async function releaseWakeLock() {
  try {
    if (!wakeLockRef.current) return;
    await wakeLockRef.current?.release();
  } catch {}
  wakeLockRef.current = null;
}


  // ring tones
  const callerToneRef = useRef(null);
  const incomingToneRef = useRef(null);

  // NEW: stash offer that arrives before receiver taps "Accept"
  const pendingOfferRef = useRef(null);

  // keep a reference to the "stash offer" handler so we can remove it later
const stashOfferHandlerRef = useRef(null);

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

    // so Inbox + ChatPane can know if it's "you called" or "they called"
    const direction = role === "caller" ? "outgoing" : "incoming";

    const callMeta = {
      direction, // "outgoing" | "incoming"
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
      console.warn(
        "[CallSheet] sendCallSummaryMessage failed:",
        e?.message || e
      );
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

      // 🔴 stash incoming offer that may arrive BEFORE user taps Accept
const stash = (msg) => {
  console.log("[CallSheet] stashed incoming offer before accept");
  pendingOfferRef.current = msg;
};
stashOfferHandlerRef.current = stash;
sc.on("webrtc:offer", stash);
    }

    return () => {
      try {
        sc.disconnect();
      } catch {}
      setSig(null);
      stopAllTones();
      setAutoStarted(false);
      setElapsedSeconds(0);
      setHasAccepted(false);
      setCallFailed(false);
      stashOfferHandlerRef.current = null;
      releaseWakeLock();
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

    // ⏲️ fail-safe: if call is accepted but never connects, fail after ~20s
  useEffect(() => {
    if (!open) return;

    const accepted = peerAccepted || hasAccepted;

    // Nobody has accepted yet → no timer
    if (!accepted) return;

    // Already connected → no need for timeout
    if (hasConnected) return;

    // Start 20s timeout once we're in "accepted but not connected" state
    const timeoutId = setTimeout(() => {
      console.warn(
        "[CallSheet] Call failed: no WebRTC connection within 20 seconds"
      );

      // 1) Stop any ringing / tones
      stopAllTones();

      // 2) Mark as failed so UI shows "Call failed"
      setCallFailed(true);

      // 3) Let backend know it failed because of timeout (optional)
      safeUpdateStatus("failed", { reason: "timeout_no_connection" });


      // 4) Auto hang up after a short pause so user can briefly see "Call failed"
      setTimeout(() => {
        hangup();
      }, 1500);
    }, 20000); // 20,000 ms = 20 seconds

    // Cleanup: if state changes (connects, closes, etc.), cancel timeout
    return () => clearTimeout(timeoutId);
  }, [open, peerAccepted, hasAccepted, hasConnected]);

  // ⏳ caller ring timeout: if nobody accepts within 30s, mark missed
useEffect(() => {
  if (!open) return;
  if (role !== "caller") return;

  // stop timer if connected or accepted
  if (hasConnected || peerAccepted) return;

  const id = setTimeout(async () => {
    try {
      stopAllTones();
      setCallFailed(true);

      await safeUpdateStatus("missed", { reason: "ring_timeout" });
      await sendCallSummaryMessage("missed");

      cleanupPeer();
      onClose?.();
    } catch {}
  }, 30000);

  return () => clearTimeout(id);
}, [open, role, hasConnected, peerAccepted]);


    // 🔔 React to backend call:status events for this call
  useEffect(() => {
    if (!open || !callId) return;

    const unsubscribe = registerSocketHandler("call:status", (evt) => {
      if (!evt) return;
      const { callId: evtId, status } = evt;

      // ignore other calls
      if (!evtId || evtId !== callId) return;

      setPeerStatus(status || null);

      // as soon as backend says "accepted", we know peer has picked
      if (status === "accepted") {
        stopAllTones();
        setPeerAccepted(true);
      }

      // if remote ends / cancels / declines, close our sheet too
      if (
        ["ended", "cancelled", "declined", "missed", "failed"].includes(
          status
        )
      ) {
        cleanupPeer();
        onClose?.();
      }
    });

    return () => {
      try {
        unsubscribe && unsubscribe();
      } catch {}
    };
  }, [open, callId, onClose]);


  async function setupPeerConnection(asCaller) {
    if (!sig || !room) return null;

    const wantVideo = mode === "video" && !camOff;

    const iceServers = await SignalingClient.getIceServers();

// ✅ MUST happen BEFORE creating a new RTCPeerConnection
if (pcRef.current) {
  try {
    pcRef.current.onicecandidate = null;
    pcRef.current.ontrack = null;
    pcRef.current.onconnectionstatechange = null;
    pcRef.current.close();
  } catch {}
  pcRef.current = null;
}

const pcNew = new RTCPeerConnection({
  iceServers,
  iceTransportPolicy: "relay", // TURN-only test
});

pcRef.current = pcNew;
setPc(pcNew);


    // ================= ICE SAFETY QUEUE (CRITICAL FOR MOBILE / iOS) =================
const pendingIce = [];
let remoteDescReady = false;

async function addIceSafely(raw) {
  if (!raw) return;

  // normalize candidate
  const ice =
    raw instanceof RTCIceCandidate ? raw : new RTCIceCandidate(raw);

  // queue ICE until remoteDescription exists
  if (!remoteDescReady || !pcNew.remoteDescription) {
    pendingIce.push(ice);
    return;
  }

  await pcNew.addIceCandidate(ice);
}

async function flushIce() {
  remoteDescReady = true;

  while (pendingIce.length) {
    const c = pendingIce.shift();
    try {
      await pcNew.addIceCandidate(c);
    } catch (e) {
      console.warn("[CallSheet] flushIce failed:", e?.message || e);
    }
  }
}
// ======================================================================


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
  } else {
    console.log("[CallSheet] ICE gathering complete");
  }
};

    pcNew.onconnectionstatechange = () => {
  const st = pcNew.connectionState;

  console.log("[CallSheet] connectionState change:", {
    connectionState: pcNew.connectionState,
    iceConnectionState: pcNew.iceConnectionState,
    signalingState: pcNew.signalingState,
  });

  if (st === "connected") {
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
  if (st === "failed") {
  cleanupPeer();
  onClose?.();
  return;
}

// ❗ DO NOT close immediately on "disconnected"
// Mobile + laptops often recover from this state


if (st === "closed") {
  setHasConnected(false);
}
};

// ✅ receiver: remove the stasher once we are ready to handle offers for real
if (!asCaller && stashOfferHandlerRef.current) {
  try {
    sig.off("webrtc:offer", stashOfferHandlerRef.current);
  } catch {}
  stashOfferHandlerRef.current = null;
}


       // signaling listeners
    const handleOffer = async (msg) => {
      try {
        const remoteSdp = msg?.payload || msg; // unwrap payload
        await pcNew.setRemoteDescription(new RTCSessionDescription(remoteSdp));
        await flushIce();
        if (!asCaller) {
          const answer = await pcNew.createAnswer();
          await pcNew.setLocalDescription(answer);
          sig.emit("webrtc:answer", answer);
        }
      } catch (e) {
        console.error("[CallSheet] handle offer failed:", e);
      }
    };

    sig.on("webrtc:offer", handleOffer);

    // 🔴 NEW: if we already received an offer BEFORE Accept, handle it now
    if (!asCaller && pendingOfferRef.current) {
      console.log("[CallSheet] processing stashed offer after accept");
      handleOffer(pendingOfferRef.current);
      pendingOfferRef.current = null;
    }


  sig.on("webrtc:answer", async (msg) => {
  try {
    if (asCaller) {
      const remoteSdp = msg?.payload || msg; // unwrap payload
      await pcNew.setRemoteDescription(
        new RTCSessionDescription(remoteSdp)
      );

      await flushIce();

      // 👇 peer has tapped "Accept" → stop ringing on caller side
      stopAllTones();
      setPeerAccepted(true);
    }
  } catch (e) {
    console.error("[CallSheet] handle answer failed:", e);
  }
});

    sig.on("webrtc:ice", async (msg) => {
  try {
    const cand = msg?.payload || msg;
    await addIceSafely(cand);
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
     const livePc = pcRef.current || pc;

if (livePc) {
  livePc.onicecandidate = null;
  livePc.ontrack = null;
  livePc.onconnectionstatechange = null;

  livePc.getSenders()?.forEach((s) => {
    try { s.track?.stop(); } catch {}
  });

  try { livePc.close(); } catch {}
}

pcRef.current = null;

      } catch {}
      pcRef.current = null;
    setPc(null);
    setHasConnected(false);
    setHasAccepted(false); // 👈 reset accept state
    setPeerAccepted(false);
    setElapsedSeconds(0); // reset duration when call ends
    setCallFailed(false);  // 👈 reset failure flag

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
  if (mode === "video") requestWakeLock();

  try {
    const ok = await sig.ready(8000);
    if (!ok) throw new Error("signaling_not_ready");

    console.log("[CallSheet] startCaller()", {
      open,
      room,
      role,
      callId,
      callType,
    });

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
    alert("Could not start call. Please check microphone/camera permissions.");
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
  if (mode === "video") requestWakeLock();

  try {
    const ok = await sig.ready(8000);
    if (!ok) throw new Error("signaling_not_ready");

    console.log("[CallSheet] acceptIncoming()", {
      open,
      room,
      role,
      callId,
      callType,
    });

    stopAllTones();
    setHasAccepted(true);
    await safeUpdateStatus("accepted");
    await setupPeerConnection(false);
  } catch (e) {
    console.error("accept call failed:", e);
    alert("Could not accept call. Please check microphone/camera permissions.");
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

  await releaseWakeLock();   // ✅ allow sleep again
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

  // When the call is open, keep the screen awake.
// When the call closes, allow screen to sleep again.
useEffect(() => {
  if (!open) {
    releaseWakeLock();
    return;
  }

  // 🔴 Only keep screen awake for VIDEO calls
  if (mode === "video") {
    requestWakeLock();
  }

  const onVis = () => {
    if (!document.hidden && mode === "video") {
      requestWakeLock();
    }
  };

  document.addEventListener("visibilitychange", onVis);

  return () => {
    document.removeEventListener("visibilitychange", onVis);
    releaseWakeLock();
  };
}, [open, mode]);



      // ---------- render ----------

  if (!open || !room) return null;

  const isCaller = role === "caller";

  // WhatsApp-like status text
  let statusText = "";
  if (callFailed) {
    statusText = "Call failed";
  } else if (hasConnected) {
    statusText = "Connected";
  } else if (starting) {
    statusText = "Connecting…";
  } else if (isCaller && peerAccepted) {
    statusText = "Connecting…";
  } else if (!isCaller && hasAccepted) {
    statusText = "Connecting…";
  } else {
    statusText = isCaller ? "Calling…" : "Incoming call";
  }

  const displayPeerName =
    peerName && peerName.trim().length ? peerName : "Unknown user";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="relative w-full max-w-xl md:rounded-2xl md:overflow-hidden bg-[#111] border border-zinc-800">
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

        {/* body: fixed height so nothing collapses */}
        <div
          className="relative bg-black overflow-hidden"
          style={{ height: "460px" }} // 👈 explicit height, ignores external flex
        >
          {/* VIDEO LAYOUT */}
    {mode === "video" && (
  <>
    {/* big view (also tap to swap) */}
    <video
      ref={pipFlipped ? localRef : remoteRef}
      autoPlay
      playsInline
      onClick={() => setPipFlipped((v) => !v)}   // 👈 tap big view to swap
      className="absolute inset-0 w-full h-full object-cover opacity-90"
    />
    <div className="absolute inset-0 bg-black/35" />


              {/* PiP bottom-right INSIDE video */}
              <video
                ref={pipFlipped ? remoteRef : localRef}
                autoPlay
                playsInline
                muted
                onClick={() => setPipFlipped((v) => !v)}
                className="absolute bottom-24 right-4 w-28 h-40 md:w-32 md:h-44 rounded-2xl border border-zinc-300 shadow-lg object-cover bg-black cursor-pointer"
              />

              {/* timer / status at bottom centre */}
              <div className="absolute bottom-32 left-0 right-0 flex justify-center z-20">
                <span className="px-3 py-1 rounded-full bg-black/70 text-xs text-zinc-100">
                  {hasConnected
                    ? formatDuration(elapsedSeconds)
                    : statusText}
                </span>
              </div>
            </>
          )}

          {/* AUDIO LAYOUT */}
          {mode === "audio" && (
            <div className="flex flex-col items-center justify-center h-full">
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

              {/* name + timer / status for audio */}
              <div className="mt-4 flex flex-col items-center gap-1">
                <span className="text-lg md:text-2xl font-semibold text-zinc-50">
                  {displayPeerName}
                </span>
                <span className="text-sm text-zinc-300 mt-1">
                  {hasConnected ? formatDuration(elapsedSeconds) : statusText}
                </span>
                <span className="text-[11px] text-zinc-500 mt-1">
                  Voice call • {isCaller ? "You are calling" : "Incoming"}
                </span>
              </div>
            </div>
          )}

          {/* bottom controls overlay (on top of video / audio) */}
          <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-3 z-30">
            <div className="flex items-center justify-center gap-10">
              {!isCaller && !hasConnected && !hasAccepted && !callFailed ? (
                <>
                  {/* Decline (red) */}
                  <button
                    className="flex items-center justify-center w-14 h-14 rounded-full bg-rose-600 text-white text-xl shadow-lg"
                    onClick={declineIncoming}
                    type="button"
                  >
                    📞
                  </button>

                  {/* Accept (green) */}
                  <button
                    className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500 text-black text-xl shadow-lg disabled:opacity-50"
                    onClick={acceptIncoming}
                    disabled={starting}
                    type="button"
                  >
                    📞
                  </button>
                </>
              ) : (
                <button
                  className="flex items-center justify-center w-14 h-14 rounded-full bg-rose-600 text-white text-xl shadow-lg mx-auto"
                  onClick={hangup}
                  type="button"
                >
                  📞
                </button>
              )}
            </div>

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

              {/* camera (video only) */}
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

              {/* chat shortcut */}
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
    </div>
  );
}

