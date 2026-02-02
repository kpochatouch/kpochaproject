// apps/web/src/components/CallSheet.jsx
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import SignalingClient from "../lib/webrtc/SignalingClient";
import {
  updateCallStatus,
  sendChatMessage,
  registerSocketHandler,
} from "../lib/api";

// ---- cross-mount stash (survives CallSheet remounts) ----
const OFFER_STASH = new Map(); // room -> msg
const ICE_STASH = new Map(); // room -> [candidates]

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
  autoAccept = false,
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

  // ring tones
  const callerToneRef = useRef(null);
  const incomingToneRef = useRef(null);

  // NEW: stash offer that arrives before receiver taps "Accept"
  const pendingOfferRef = useRef(null);

  // NEW: queue ICE candidates until remoteDescription is set
  const pendingIceRef = useRef([]);

  // NEW: keep the latest caller offer so we can resend it if receiver missed it
  const lastOfferRef = useRef(null);
  // NEW: retry sending offer when receiver wasn't in the room yet
  const offerRetryTimerRef = useRef(null);

  const autoAcceptedRef = useRef(false);

  // DEBUG
  const DEBUG_CALL = true;
  const dlog = (...args) => {
    if (!DEBUG_CALL) return;
    console.log("[CallDBG]", ...args);
  };

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
      status, // "ended" | "cancelled" | "declined" | "missed" | "failed"
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
        e?.message || e,
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
      role === "caller" ? "caller" : "receiver",
    );
    sc.connect();
    setSig(sc);

    dlog("sheet open", {
      role,
      room,
      callId,
      callType,
      autoAccept,
      native: Capacitor.isNativePlatform(),
    });

    // ✅ restore stash from a previous CallSheet instance (Android remount)
    if (role !== "caller") {
      const savedOffer = OFFER_STASH.get(room);
      const savedIce = ICE_STASH.get(room);

      if (savedOffer && !pendingOfferRef.current) {
        pendingOfferRef.current = savedOffer;
        console.log("[CallSheet] restored stashed offer on mount");
      }

      if (
        Array.isArray(savedIce) &&
        savedIce.length &&
        !pendingIceRef.current.length
      ) {
        pendingIceRef.current = [...savedIce];
        console.log(
          "[CallSheet] restored stashed ICE on mount:",
          pendingIceRef.current.length,
        );
      }
    }

    let stashOffer = null;
    let stashIce = null;

    if (role !== "caller") {
      // incoming side: start ringtone immediately (web/PWA only)
      if (!Capacitor.isNativePlatform()) {
        try {
          const audio = new Audio("/sound/incoming.mp3");
          audio.loop = true;
          incomingToneRef.current = audio;
          audio.play().catch(() => {});
        } catch {}
      }

      // stash offer (may arrive before Accept)
      stashOffer = (msg) => {
        console.log("[CallSheet] stashed incoming offer before accept");
        pendingOfferRef.current = msg;
      };
      sc.on("webrtc:offer", stashOffer);

      // stash ICE (may arrive before Accept)
      stashIce = (msg) => {
        const cand = msg?.payload || msg;
        if (!cand) return;
        pendingIceRef.current.push(cand);
        console.log(
          "[CallSheet] stashed ICE before accept",
          pendingIceRef.current.length,
        );
      };
      sc.on("webrtc:ice", stashIce);
    }

    return () => {
      try {
        if (stashOffer) sc.off("webrtc:offer", stashOffer);
        if (stashIce) sc.off("webrtc:ice", stashIce);
      } catch {}

      try {
        sc.disconnect();
      } catch {}

      pendingOfferRef.current = null;
      pendingIceRef.current = [];

      setSig(null);
      stopAllTones();

      // stop offer retry loop (caller side)
      if (offerRetryTimerRef.current) {
        clearInterval(offerRetryTimerRef.current);
        offerRetryTimerRef.current = null;
      }

      setAutoStarted(false);
      setElapsedSeconds(0);
      setHasAccepted(false);
      setCallFailed(false);
      autoAcceptedRef.current = false;
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

  // ⏳ ring timeout: if receiver never answers, end as "missed"
  useEffect(() => {
    if (!open) return;
    if (role !== "caller") return;

    // if already connected or receiver accepted, don't ring-timeout
    if (hasConnected || peerAccepted || hasAccepted) return;

    // start countdown once caller sheet is open and dialing
    const id = setTimeout(() => {
      console.warn("[CallSheet] Ring timeout: no answer");

      // End as "missed" (not failed)
      hangup("missed");
    }, 30000); // 30s (adjust if you want)

    return () => clearTimeout(id);
  }, [open, role, hasConnected, peerAccepted, hasAccepted]);

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
        "[CallSheet] Call failed: no WebRTC connection within 20 seconds",
      );

      // 1) Stop any ringing / tones
      stopAllTones();

      // 2) Mark as failed so UI shows "Call failed"
      setCallFailed(true);

      // 3) Let backend know it failed because of timeout (optional)
      safeUpdateStatus("failed", { reason: "timeout_no_connection" });

      // 4) Auto hang up after a short pause so user can briefly see "Call failed"
      setTimeout(() => {
        hangup("failed");
      }, 1500);
    }, 20000); // 20,000 ms = 20 seconds

    // Cleanup: if state changes (connects, closes, etc.), cancel timeout
    return () => clearTimeout(timeoutId);
  }, [open, peerAccepted, hasAccepted, hasConnected]);

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
        ["ended", "cancelled", "declined", "missed", "failed"].includes(status)
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
    console.log("[ICECFG] iceServers", iceServers);

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
          const out = ev.candidate.toJSON
            ? ev.candidate.toJSON()
            : ev.candidate;
          sig.emit("webrtc:ice", out);
        } catch (e) {
          console.warn("[CallSheet] emit ice failed:", e?.message || e);
        }
      } else {
        console.log("[CallSheet] ICE gathering complete");
      }
    };

    pcNew.oniceconnectionstatechange = () => {
      console.log("[CallSheet] iceConnectionState:", pcNew.iceConnectionState);
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
      if (["disconnected", "failed", "closed"].includes(st)) {
        setHasConnected(false);
      }
    };

    // signaling listeners
    const handleOffer = async (msg) => {
      try {
        const remoteSdp = msg?.payload || msg; // unwrap payload
        dlog("RX offer", {
          asCaller,
          hasRemoteDesc: !!pcNew.remoteDescription,
          signalingState: pcNew.signalingState,
        });

        await pcNew.setRemoteDescription(new RTCSessionDescription(remoteSdp));

        // NEW: flush any ICE that arrived early (receiver side too)
        if (pendingIceRef.current.length) {
          const queued = [...pendingIceRef.current];
          pendingIceRef.current = [];
          for (const c of queued) {
            try {
              await pcNew.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {
              console.warn(
                "[CallSheet] flush addIceCandidate failed:",
                e?.message || e,
              );
            }
          }
        }

        if (!asCaller) {
          const answer = await pcNew.createAnswer();
          await pcNew.setLocalDescription(answer);
          dlog("TX answer", { asCaller, signalingState: pcNew.signalingState });

          // send WebRTC answer first
          sig.emit("webrtc:answer", answer);

          // NOW it is safe to tell backend "accepted"
          // (caller should not stop offer resend until they get this answer)
          safeUpdateStatus("accepted").catch(() => {});
        }
      } catch (e) {
        console.error("[CallSheet] handle offer failed:", e);
      }
    };

    if (!asCaller) {
      sig.on("webrtc:offer", handleOffer);
    }

    // 🔴 NEW: if we already received an offer BEFORE Accept, handle it now
    if (!asCaller && pendingOfferRef.current) {
      console.log("[CallSheet] processing stashed offer after accept");
      handleOffer(pendingOfferRef.current);
      pendingOfferRef.current = null;
    }

    const onAnswer = async (msg) => {
      try {
        if (!asCaller) return;

        // ✅ IMPORTANT: Only accept answer when we actually have a local offer
        if (pcNew.signalingState !== "have-local-offer") {
          console.warn(
            "[CallSheet] ignoring duplicate/late answer; signalingState:",
            pcNew.signalingState,
          );
          return;
        }

        const remoteSdp = msg?.payload || msg;
        dlog("RX answer", {
          asCaller,
          signalingState: pcNew.signalingState,
          hasLocalDesc: !!pcNew.localDescription,
        });

        await pcNew.setRemoteDescription(new RTCSessionDescription(remoteSdp));
        // stop retrying offer once we got an answer
        if (offerRetryTimerRef.current) {
          clearInterval(offerRetryTimerRef.current);
          offerRetryTimerRef.current = null;
        }

        // NEW: flush any ICE that arrived early
        if (pendingIceRef.current.length) {
          const queued = [...pendingIceRef.current];
          pendingIceRef.current = [];
          for (const c of queued) {
            try {
              await pcNew.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) {
              console.warn(
                "[CallSheet] flush addIceCandidate failed:",
                e?.message || e,
              );
            }
          }
        }

        stopAllTones();
        setPeerAccepted(true);
      } catch (e) {
        console.error("[CallSheet] handle answer failed:", e);
      }
    };

    const onIce = async (msg) => {
      try {
        const cand = msg?.payload || msg;
        dlog("RX ice", {
          asCaller,
          hasRemoteDesc: !!pcNew.remoteDescription,
          queued: pendingIceRef.current.length,
        });
        if (!cand) return;

        // If remoteDescription not ready yet, store candidate
        if (!pcNew.remoteDescription) {
          pendingIceRef.current.push(cand);
          return;
        }

        await pcNew.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn("[CallSheet] addIceCandidate failed:", e?.message || e);
      }
    };

    sig.on("webrtc:answer", onAnswer);
    sig.on("webrtc:ice", onIce);

    // ✅ If receiver missed the offer (lockscreen delay), they can request resend
    const onNeedOffer = async (msg) => {
      try {
        if (!asCaller) return;

        const req = msg?.payload || msg;
        dlog("RX need-offer", { req, asCaller, room, callId });

        console.log("[CallSheet] got need-offer", { req, room, callId });

        const offer = lastOfferRef.current || pcNew.localDescription;
        if (!offer) {
          console.warn("[CallSheet] need-offer but no local offer to resend");
          return;
        }

        console.log("[CallSheet] resend offer -> receiver requested");
        sig.emit("webrtc:offer", offer);
      } catch (e) {
        console.warn("[CallSheet] resend offer failed:", e?.message || e);
      }
    };

    sig.on("webrtc:need-offer", onNeedOffer);

    // ✅ store handlers so cleanupPeer can remove them later
    pcNew.__sigHandlers = {
      onAnswer,
      onIce,
      onOffer: handleOffer,
      onNeedOffer,
    };

    // caller creates offer immediately
    if (asCaller) {
      const offer = await pcNew.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: wantVideo,
      });
      await pcNew.setLocalDescription(offer);

      // ✅ remember it for resends (lockscreen / reconnect cases)
      lastOfferRef.current = offer;
      dlog("TX offer", { asCaller, signalingState: pcNew.signalingState });

      // Send the offer immediately
      sig.emit("webrtc:offer", offer);

      // Proactively resend the offer for a few seconds until we get an answer.
      // This avoids relying on webrtc:need-offer (your server isn't forwarding it).
      if (offerRetryTimerRef.current) {
        clearInterval(offerRetryTimerRef.current);
        offerRetryTimerRef.current = null;
      }

      let tries = 0;
      offerRetryTimerRef.current = setInterval(() => {
        tries += 1;

        // stop retry only when the call is actually progressing at WebRTC level
        if (!open || !sig || hasConnected) {
          clearInterval(offerRetryTimerRef.current);
          offerRetryTimerRef.current = null;
          return;
        }

        const offerNow = lastOfferRef.current;
        if (!offerNow) {
          clearInterval(offerRetryTimerRef.current);
          offerRetryTimerRef.current = null;
          return;
        }

        dlog("retry offer", { tries });
        sig.emit("webrtc:offer", offerNow);

        // 30 tries * 1000ms ≈ 30 seconds (covers Android remount / reconnect)
        if (tries >= 30) {
          clearInterval(offerRetryTimerRef.current);
          offerRetryTimerRef.current = null;
        }
      }, 1000);
    }
    return pcNew;
  }

  function cleanupPeer() {
    stopAllTones();

    // ✅ call ended -> clear cross-mount stash
    try {
      OFFER_STASH.delete(room);
      ICE_STASH.delete(room);
    } catch {}

    // stop offer retry loop (caller side)
    if (offerRetryTimerRef.current) {
      clearInterval(offerRetryTimerRef.current);
      offerRetryTimerRef.current = null;
    }

    // 🔽 clear any stashed signaling so it never leaks into next call
    // ✅ persist stash across remounts (Android accept can remount CallSheet)
    try {
      if (role !== "caller") {
        if (pendingOfferRef.current)
          OFFER_STASH.set(room, pendingOfferRef.current);
        if (pendingIceRef.current?.length)
          ICE_STASH.set(room, [...pendingIceRef.current]);
      }
    } catch {}

    pendingOfferRef.current = null;
    pendingIceRef.current = [];

    // ✅ remove signaling listeners attached in setupPeerConnection()
    try {
      const h = pc?.__sigHandlers;
      if (h && sig) {
        if (h.onAnswer) sig.off("webrtc:answer", h.onAnswer);
        if (h.onIce) sig.off("webrtc:ice", h.onIce);
        if (h.onOffer) sig.off("webrtc:offer", h.onOffer);
        if (h.onNeedOffer) sig.off("webrtc:need-offer", h.onNeedOffer);
      }
    } catch {}

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
    setPeerAccepted(false);
    setElapsedSeconds(0); // reset duration when call ends
    setCallFailed(false); // 👈 reset failure flag

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
      alert(
        "Could not start call. Please check microphone/camera permissions.",
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
      console.log("[CallSheet] acceptIncoming()", {
        open,
        room,
        role,
        callId,
        callType,
      });

      setHasAccepted(true); // 👈 receiver has accepted
      const pcNew = await setupPeerConnection(false);
      // ✅ If we still don't have an offer shortly after accept,
      // request the caller to resend it (lockscreen delay fix).
      setTimeout(() => {
        try {
          const hasOfferNow =
            !!pendingOfferRef.current || !!pcNew?.remoteDescription;

          if (!hasOfferNow) {
            console.warn(
              "[CallSheet] no offer after accept -> requesting resend",
            );
            // Send both shapes (some servers wrap in {payload})
            dlog("TX need-offer", { callId, room });
            sig?.emit("webrtc:need-offer", { callId, room });
            sig?.emit("webrtc:need-offer", { payload: { callId, room } });
          }
        } catch {}
      }, 800);
    } catch (e) {
      console.error("accept call failed:", e);
      alert(
        "Could not accept call. Please check microphone/camera permissions.",
      );
      await safeUpdateStatus("declined", { reason: "media_error" });
      cleanupPeer();
      onClose?.();
    } finally {
      setStarting(false);
    }
  }

  // ✅ Native Accept -> deep link sets autoAccept, so receiver auto-runs acceptIncoming() once
  useEffect(() => {
    if (!open) return;
    if (role === "caller") return;
    if (!autoAccept) return;

    // wait until signaling is ready
    if (!sig) return;

    // guard: do not double-accept
    if (starting) return;
    if (hasAccepted) return;
    if (autoAcceptedRef.current) return;

    autoAcceptedRef.current = true;
    acceptIncoming();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, role, autoAccept, sig]);

  async function declineIncoming() {
    stopAllTones();
    await safeUpdateStatus("declined");
    await sendCallSummaryMessage("declined");
    cleanupPeer();
    onClose?.();
  }

  // ---- hangup (both roles) ----

  async function hangup(forceStatus = null) {
    if (forceStatus && typeof forceStatus !== "string") {
      forceStatus = null;
    }
    stopAllTones();
    const endedStatus =
      forceStatus ||
      (hasConnected ? "ended" : role === "caller" ? "cancelled" : "declined");

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
            onClick={() => hangup()}
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
                onClick={() => setPipFlipped((v) => !v)} // 👈 tap big view to swap
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
                  {hasConnected ? formatDuration(elapsedSeconds) : statusText}
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
                  onClick={() => hangup()}
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
