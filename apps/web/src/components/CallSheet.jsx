// apps/web/src/components/CallSheet.jsx
import { useEffect, useRef, useState } from "react";
import SignalingClient from "../lib/webrtc/SignalingClient";
import {
  updateCallStatus,
  sendChatMessage,
  registerSocketHandler,
} from "../lib/api";
import { Capacitor } from "@capacitor/core";
import DisplayName from "./DisplayName.jsx";

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
  peerVerified = false,
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
  const [peerReady, setPeerReady] = useState(false); // ✅ receiver says “UI ready”
  const readySentRef = useRef(false); // ✅ receiver sends ready only once

  // ✅ refs (avoid stale React state inside timers/promises)
  const peerReadyRef = useRef(false);
  const gotAnswerRef = useRef(false);

  // ✅ caller offer resend loop
  const offerResendTimerRef = useRef(null);

  // ✅ prevent stale timers/events from older calls triggering failures
  const callSessionRef = useRef(0);

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
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);

  // ring tones
  const callerToneRef = useRef(null);
  const incomingToneRef = useRef(null);

  // NEW: stash offer that arrives before receiver taps "Accept"
  const pendingOfferRef = useRef(null);

  // NEW: queue ICE candidates until remoteDescription is set
  const pendingIceRef = useRef([]);
  const shouldHardCleanupRef = useRef(false);

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

  async function attachStream(videoEl, stream, { muted = false } = {}) {
    try {
      if (!videoEl || !stream) return;

      videoEl.srcObject = stream;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.muted = muted;

      const tryPlay = async () => {
        try {
          await videoEl.play();
        } catch {}
      };

      if (videoEl.readyState >= 1) {
        await tryPlay();
      } else {
        videoEl.onloadedmetadata = () => {
          tryPlay();
        };
      }
    } catch (e) {
      console.warn("[CallSheet] attachStream failed:", e?.message || e);
    }
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

    // ✅ new call session begins as soon as this sheet opens for a room
    callSessionRef.current += 1;

    const sc = new SignalingClient(
      room,
      role === "caller" ? "caller" : "receiver",
    );
    sc.connect();
    setSig(sc);
    shouldHardCleanupRef.current = false;

    // ✅ barrier handshake: receiver tells caller "I'm ready"
    const onPeerReady = (msg) => {
      try {
        const p = msg?.payload || msg;
        if (!p) return;
        if (callId && p.callId && p.callId !== callId) return;
        try {
          sc.off("call:ready", onPeerReady);
        } catch {}

        console.log("[CallSheet] peerReady received", p);
        peerReadyRef.current = true;
        setPeerReady(true);
      } catch {}
    };
    sc.on("call:ready", onPeerReady);

    let stashOffer = null;
    let stashIce = null;

    if (role !== "caller") {
      // ✅ Incoming ringtone only for web/PWA.
      // Native already rings via Android (ForegroundService / system).
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
        if (shouldHardCleanupRef.current) {
          sc.disconnect();
        } else {
          console.log("[CallSheet] skip disconnect on remount");
        }
      } catch {}

      pendingOfferRef.current = null;
      pendingIceRef.current = [];

      setSig(null);
      stopAllTones();
      setAutoStarted(false);
      setElapsedSeconds(0);
      setHasAccepted(false);
      setCallFailed(false);
      setPeerAccepted(false);
      setPeerReady(false);
      readySentRef.current = false;
      peerReadyRef.current = false;
      gotAnswerRef.current = false;

      // stop caller offer resend loop (if any)
      try {
        if (offerResendTimerRef.current) {
          clearInterval(offerResendTimerRef.current);
          offerResendTimerRef.current = null;
        }
      } catch {}
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
    if (!accepted) return;
    if (hasConnected) return;

    // ✅ guard: only the current call session may fail itself
    const mySession = callSessionRef.current;

    const timeoutId = setTimeout(() => {
      if (callSessionRef.current !== mySession) return;

      console.warn(
        "[CallSheet] Call failed: no WebRTC connection within 20 seconds",
      );

      stopAllTones();
      setCallFailed(true);
      safeUpdateStatus("failed", { reason: "timeout_no_connection" });

      setTimeout(() => {
        if (callSessionRef.current !== mySession) return;
        hangup("failed");
      }, 1500);
    }, 20000);

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

  // ✅ Auto-accept when opened from native Android accept
  useEffect(() => {
    if (!open || !room) return;
    if (role !== "receiver") return;
    if (!autoAccept) return;
    if (hasAccepted) return;
    if (!sig) return;

    console.log("[CallSheet] autoAccept triggered");
    acceptIncoming();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, room, role, autoAccept, sig, hasAccepted]);

  async function setupPeerConnection(asCaller) {
    if (!sig || !room) return null;

    const wantVideo = mode === "video" && !camOff;

    const iceServers = await SignalingClient.getIceServers();

    const pcNew = new RTCPeerConnection({ iceServers });
    setPc(pcNew);
    const mySession = callSessionRef.current;

    // local media
    const mediaConstraints = {
      audio: true,
      video: wantVideo
        ? {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    localStreamRef.current = stream;

    stream.getTracks().forEach((t) => pcNew.addTrack(t, stream));

    if (localRef.current) {
      await attachStream(localRef.current, stream, { muted: true });
    }
    // remote media
    remoteStreamRef.current = new MediaStream();

    pcNew.ontrack = async (ev) => {
      if (callSessionRef.current !== mySession) return;

      try {
        const inbound = ev.track;
        if (!inbound) return;

        const existingTracks = remoteStreamRef.current.getTracks();
        const alreadyAdded = existingTracks.some((t) => t.id === inbound.id);

        if (!alreadyAdded) {
          remoteStreamRef.current.addTrack(inbound);
        }

        if (remoteRef.current) {
          await attachStream(remoteRef.current, remoteStreamRef.current, {
            muted: false,
          });
        }

        console.log("[CallSheet] remote track added", {
          kind: inbound.kind,
          id: inbound.id,
          readyState: inbound.readyState,
          remoteTrackCount: remoteStreamRef.current.getTracks().length,
        });
      } catch (e) {
        console.warn("[CallSheet] ontrack failed:", e?.message || e);
      }
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
      if (callSessionRef.current !== mySession) return; // ✅ ignore stale PC events
      console.log("[CallSheet] iceConnectionState:", pcNew.iceConnectionState);
    };

    pcNew.onconnectionstatechange = () => {
      if (callSessionRef.current !== mySession) return; // ✅ ignore stale PC events

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

      // ✅ only mark disconnected if THIS call had connected before (prevents false negatives)
      if (["disconnected", "failed", "closed"].includes(st)) {
        setHasConnected((prev) => (prev ? false : prev));
      }
    };

    // signaling listeners
    const handleOffer = async (msg) => {
      try {
        const remoteSdp = msg?.payload || msg; // unwrap payload
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
          sig.emit("webrtc:answer", answer);
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
        await pcNew.setRemoteDescription(new RTCSessionDescription(remoteSdp));

        gotAnswerRef.current = true;
        try {
          if (offerResendTimerRef.current) {
            clearInterval(offerResendTimerRef.current);
            offerResendTimerRef.current = null;
          }
        } catch {}

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

    // ✅ store handlers so cleanupPeer can remove them later
    pcNew.__sigHandlers = { onAnswer, onIce, onOffer: handleOffer };

    // caller creates offer immediately + resend loop for swiped-out cold start
    if (asCaller) {
      const offer = await pcNew.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: wantVideo,
      });
      await pcNew.setLocalDescription(offer);

      const sendOfferOnce = () => {
        try {
          sig.emit("webrtc:offer", offer, (ack) => {
            // ack: { ok, room, deliveredTo, totalInRoom }
            console.log("[CallSheet] offer ack", ack);
          });
        } catch {}
      };

      // send immediately
      sendOfferOnce();

      // clear old timer if any
      try {
        if (offerResendTimerRef.current)
          clearInterval(offerResendTimerRef.current);
      } catch {}

      offerResendTimerRef.current = setInterval(() => {
        if (gotAnswerRef.current) return;
        if (pcNew.signalingState !== "have-local-offer") return; // only while offer outstanding
        sendOfferOnce();
      }, 1200);
    }

    return pcNew;
  }

  function cleanupPeer() {
    stopAllTones();
    shouldHardCleanupRef.current = true;

    // ✅ invalidate old timers/handlers
    callSessionRef.current += 1;

    // stop caller offer resend loop
    try {
      if (offerResendTimerRef.current) {
        clearInterval(offerResendTimerRef.current);
        offerResendTimerRef.current = null;
      }
    } catch {}
    gotAnswerRef.current = false;
    peerReadyRef.current = false;

    // 🔽 clear any stashed signaling so it never leaks into next call
    pendingOfferRef.current = null;
    pendingIceRef.current = [];

    // ✅ remove signaling listeners attached in setupPeerConnection()
    try {
      const h = pc?.__sigHandlers;
      if (h && sig) {
        if (h.onAnswer) sig.off("webrtc:answer", h.onAnswer);
        if (h.onIce) sig.off("webrtc:ice", h.onIce);
        if (h.onOffer) sig.off("webrtc:offer", h.onOffer);
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
    setPeerReady(false);
    readySentRef.current = false;
    setElapsedSeconds(0); // reset duration when call ends
    setCallFailed(false); // 👈 reset failure flag

    // stop local & remote streams
    if (localStreamRef.current) {
      try {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      localStreamRef.current = null;
    }

    if (remoteStreamRef.current) {
      try {
        remoteStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      remoteStreamRef.current = null;
    }

    if (localRef.current) {
      try {
        localRef.current.pause?.();
      } catch {}
      localRef.current.srcObject = null;
    }

    if (remoteRef.current) {
      try {
        remoteRef.current.pause?.();
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

      await safeUpdateStatus("ringing");

      // ✅ Wait for receiver readiness barrier (ref-safe; longer for cold start)
      const readyOrTimeout = await new Promise((resolve) => {
        if (peerReadyRef.current) return resolve(true);

        const maxWaitMs = 15000; // swiped-out cold start
        const t = setTimeout(() => resolve(false), maxWaitMs);

        const id = setInterval(() => {
          if (peerReadyRef.current) {
            clearTimeout(t);
            clearInterval(id);
            resolve(true);
          }
        }, 150);
      });

      console.log("[CallSheet] startCaller barrier result:", readyOrTimeout, {
        peerReadyRef: peerReadyRef.current,
      });

      await setupPeerConnection(true);
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

      stopAllTones();
      setHasAccepted(true);
      await safeUpdateStatus("accepted");

      // ✅ tell caller “receiver UI is alive and accepted”
      if (!readySentRef.current) {
        readySentRef.current = true;
        sig.emit("call:ready", { callId, room, ts: Date.now() });
      }

      await setupPeerConnection(false);
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
                  <DisplayName
                    name={displayPeerName}
                    verified={!!peerVerified}
                    badgeClassName="w-5 h-5"
                  />
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
