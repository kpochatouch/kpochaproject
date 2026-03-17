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
 * - uiMode: "expanded" | "minimized"
 * - onClose: () => void          // minimize only
 * - onRestore: () => void        // restore from mini
 * - onEnd: () => void            // true end / destroy call
 * - role: "caller" | "receiver"  (default "caller")
 * - callId: string | null
 * - callType: "audio" | "video"  (default "audio")
 * - peerName: string
 * - peerAvatar: string
 */

export default function CallSheet({
  room,
  me,
  uiMode = "expanded",
  onClose,
  onRestore,
  onMessage,
  role = "caller",
  callId = null,
  callType = "audio",
  peerName = "",
  peerAvatar = "",
  peerVerified = false,
  chatRoom = null,
  autoAccept = false,
  onEnd,
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
  const peerAcceptedRef = useRef(false);
  const hasAcceptedRef = useRef(false);
  const everConnectedRef = useRef(false);

  // ✅ caller offer resend loop
  const offerResendTimerRef = useRef(null);

  // ✅ prevent stale timers/events from older calls triggering failures
  const callSessionRef = useRef(0);

  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(mode === "audio");
  const [cameraFacing, setCameraFacing] = useState("user");

  // ⏱ call duration state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // ❌ call failed state (when accepted but never connects)
  const [callFailed, setCallFailed] = useState(false);

  const [pipFlipped, setPipFlipped] = useState(false);
  const [localVideoReady, setLocalVideoReady] = useState(false);
  const [remoteVideoReady, setRemoteVideoReady] = useState(false);

  const miniDragRef = useRef(null);
  const miniResizeRef = useRef(null);

  const [desktopMiniRect, setDesktopMiniRect] = useState({
    x: 24,
    y: 120,
    w: 220,
    h: 300,
  });

  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const ringtoneAudioRef = useRef(null);
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

  const isExpanded = uiMode !== "minimized";

  function getVideoConstraints(facing = cameraFacing) {
    return {
      facingMode: { ideal: facing },
    };
  }

  function clearMediaSession() {
    try {
      if (!("mediaSession" in navigator)) return;

      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";

      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("stop", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    } catch {}
  }

  function stopAllTones() {
    [callerToneRef, incomingToneRef, ringtoneAudioRef].forEach((ref) => {
      try {
        if (ref.current) {
          ref.current.pause();
          ref.current.currentTime = 0;
        }
      } catch {}
    });

    try {
      if (callerToneRef.current) {
        callerToneRef.current.removeAttribute?.("src");
        callerToneRef.current.src = "";
        callerToneRef.current.load?.();
      }
    } catch {}

    try {
      if (
        incomingToneRef.current &&
        incomingToneRef.current !== ringtoneAudioRef.current
      ) {
        incomingToneRef.current.removeAttribute?.("src");
        incomingToneRef.current.src = "";
        incomingToneRef.current.load?.();
      }
    } catch {}

    try {
      if (ringtoneAudioRef.current) {
        ringtoneAudioRef.current.removeAttribute("src");
        ringtoneAudioRef.current.src = "";
        ringtoneAudioRef.current.load?.();
        ringtoneAudioRef.current.remove?.();
      }
    } catch {}

    callerToneRef.current = null;
    incomingToneRef.current = null;
    ringtoneAudioRef.current = null;

    clearMediaSession();
  }

  function startIncomingRingtone() {
    if (Capacitor.isNativePlatform()) return;
    if (incomingToneRef.current || ringtoneAudioRef.current) return;

    try {
      const audio = document.createElement("audio");
      audio.src = "/sound/incoming.mp3";
      audio.loop = true;
      audio.preload = "auto";
      audio.playsInline = true;
      audio.setAttribute("playsinline", "true");
      audio.style.display = "none";

      document.body.appendChild(audio);

      ringtoneAudioRef.current = audio;
      incomingToneRef.current = audio;

      try {
        if ("mediaSession" in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: "Incoming call",
            artist: peerName && peerName.trim() ? peerName : "Kpocha Touch",
            album: callType === "video" ? "Video call" : "Voice call",
            artwork: peerAvatar
              ? [
                  { src: peerAvatar, sizes: "96x96", type: "image/png" },
                  { src: peerAvatar, sizes: "192x192", type: "image/png" },
                  { src: peerAvatar, sizes: "512x512", type: "image/png" },
                ]
              : [],
          });

          navigator.mediaSession.playbackState = "playing";

          navigator.mediaSession.setActionHandler("play", () => {
            audio.play().catch(() => {});
          });

          navigator.mediaSession.setActionHandler("pause", () => {
            audio.pause();
          });

          navigator.mediaSession.setActionHandler("stop", () => {
            stopAllTones();
          });

          navigator.mediaSession.setActionHandler("seekbackward", null);
          navigator.mediaSession.setActionHandler("seekforward", null);
          navigator.mediaSession.setActionHandler("previoustrack", null);
          navigator.mediaSession.setActionHandler("nexttrack", null);
        }
      } catch {}

      audio.play().catch(() => {});
    } catch {}
  }

  function startCallerTone() {
    if (callerToneRef.current) return;

    try {
      const audio = new Audio("/sound/caller-tune.mp3");
      audio.loop = true;
      callerToneRef.current = audio;
      audio.play().catch(() => {});
    } catch {}
  }

  async function attachStream(
    videoEl,
    stream,
    { muted = false, kind = "remote" } = {},
  ) {
    try {
      if (!videoEl || !stream) return;

      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
      }

      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.muted = muted;
      videoEl.setAttribute("playsinline", "true");
      videoEl.setAttribute("webkit-playsinline", "true");

      const markReady = () => {
        if (kind === "local") setLocalVideoReady(true);
        if (kind === "remote") setRemoteVideoReady(true);
      };

      videoEl.onloadedmetadata = () => {
        markReady();
        videoEl.play?.().catch(() => {});
      };

      videoEl.onloadeddata = () => {
        markReady();
      };

      videoEl.oncanplay = () => {
        markReady();
      };

      videoEl.onplaying = () => {
        markReady();
      };

      await videoEl.play().catch(() => {});
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

  useEffect(() => {
    function onMouseMove(e) {
      if (miniDragRef.current) {
        const { startX, startY, originX, originY } = miniDragRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        setDesktopMiniRect((prev) => ({
          ...prev,
          x: Math.max(8, originX + dx),
          y: Math.max(8, originY + dy),
        }));
      }

      if (miniResizeRef.current) {
        const { startX, startY, originW, originH } = miniResizeRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        setDesktopMiniRect((prev) => ({
          ...prev,
          w: Math.max(180, originW + dx),
          h: Math.max(220, originH + dy),
        }));
      }
    }

    function onMouseUp() {
      miniDragRef.current = null;
      miniResizeRef.current = null;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // setup signaling for the active call session
  // IMPORTANT: this must depend on room, not on open/minimized UI state
  useEffect(() => {
    if (!room) return;

    // ✅ new call session begins as soon as this component is mounted for a room
    callSessionRef.current += 1;

    const sc = new SignalingClient(
      room,
      role === "caller" ? "caller" : "receiver",
    );
    sc.connect();
    setSig(sc);
    shouldHardCleanupRef.current = false;

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
      startIncomingRingtone();

      stashOffer = (msg) => {
        if (peerAcceptedRef.current) {
          console.log(
            "[CallSheet] ignoring offer; call already accepted elsewhere",
          );
          return;
        }

        console.log("[CallSheet] stashed incoming offer before accept");
        pendingOfferRef.current = msg;
      };

      sc.on("webrtc:offer", stashOffer);

      stashIce = (msg) => {
        if (peerAcceptedRef.current) {
          console.log(
            "[CallSheet] ignoring ICE; call already accepted elsewhere",
          );
          return;
        }

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

      try {
        if (offerResendTimerRef.current) {
          clearInterval(offerResendTimerRef.current);
          offerResendTimerRef.current = null;
        }
      } catch {}
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, role, callId]);

  useEffect(() => {
    peerAcceptedRef.current = peerAccepted;
  }, [peerAccepted]);

  useEffect(() => {
    hasAcceptedRef.current = hasAccepted;
  }, [hasAccepted]);

  useEffect(() => {
    if (mode !== "video") return;

    if (localRef.current && localStreamRef.current) {
      attachStream(localRef.current, localStreamRef.current, {
        muted: true,
        kind: "local",
      });
    }

    if (remoteRef.current && remoteStreamRef.current) {
      attachStream(remoteRef.current, remoteStreamRef.current, {
        muted: false,
        kind: "remote",
      });
    }
  }, [mode, hasAccepted, peerAccepted, hasConnected]);

  // ⏱ duration timer: start counting only when connected
  useEffect(() => {
    if (!room) return;
    if (!hasConnected) return;

    const id = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(id);
  }, [room, hasConnected]);

  // ⏳ ring timeout: if receiver never answers, end as "missed"
  useEffect(() => {
    if (!room) return;
    if (role !== "caller") return;

    if (hasConnected || peerAccepted || hasAccepted) return;

    const id = setTimeout(() => {
      console.warn("[CallSheet] Ring timeout: no answer");
      hangup("missed");
    }, 60000);

    return () => clearTimeout(id);
  }, [room, role, hasConnected, peerAccepted, hasAccepted]);

  // ⏲️ fail-safe: only for calls that have NEVER connected
  useEffect(() => {
    if (!room) return;

    const accepted = peerAccepted || hasAccepted;
    if (!accepted) return;
    if (hasConnected) return;
    if (everConnectedRef.current) return;

    const mySession = callSessionRef.current;

    const timeoutId = setTimeout(() => {
      if (callSessionRef.current !== mySession) return;
      if (everConnectedRef.current) return;

      console.warn(
        "[CallSheet] Call failed: no WebRTC connection within 20 seconds",
      );

      stopAllTones();
      setCallFailed(true);
      safeUpdateStatus("failed", { reason: "timeout_no_connection" });

      setTimeout(() => {
        if (callSessionRef.current !== mySession) return;
        if (everConnectedRef.current) return;
        hangup("failed");
      }, 1500);
    }, 20000);

    return () => clearTimeout(timeoutId);
  }, [room, peerAccepted, hasAccepted, hasConnected]);

  // 🔔 React to backend call:status events for this call
  useEffect(() => {
    if (!callId) return;

    const unsubscribe = registerSocketHandler("call:status", (evt) => {
      if (!evt) return;
      const { callId: evtId, status } = evt;

      if (!evtId || evtId !== callId) return;

      setPeerStatus(status || null);

      if (status === "accepted") {
        stopAllTones();
        setPeerAccepted(true);

        // Another device for this same receiver answered first.
        // This device must leave the session completely.
        if (role === "receiver" && !hasAcceptedRef.current) {
          cleanupPeer();
          onEnd?.();
          return;
        }
      }

      if (
        ["ended", "cancelled", "declined", "missed", "failed"].includes(status)
      ) {
        cleanupPeer();
        onEnd?.();
      }
    });

    return () => {
      try {
        unsubscribe && unsubscribe();
      } catch {}
    };
  }, [callId, role, onEnd]);

  // ✅ Auto-accept when opened from native Android accept
  useEffect(() => {
    if (!room) return;
    if (role !== "receiver") return;
    if (!autoAccept) return;
    if (hasAccepted) return;
    if (!sig) return;

    console.log("[CallSheet] autoAccept triggered");
    acceptIncoming();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, role, autoAccept, sig, hasAccepted]);

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
      video: wantVideo ? getVideoConstraints(cameraFacing) : false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    localStreamRef.current = stream;

    stream.getTracks().forEach((t) => pcNew.addTrack(t, stream));

    if (localRef.current) {
      await attachStream(localRef.current, stream, {
        muted: true,
        kind: "local",
      });
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
            kind: "remote",
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
        everConnectedRef.current = true;

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

      // Do NOT downgrade a once-connected call back to "connecting"
      // because transient WebRTC state changes can happen during a healthy call.
      if (["disconnected", "failed", "closed"].includes(st)) {
        console.warn("[CallSheet] connectionState transient/end:", st);
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
    everConnectedRef.current = false;

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
    setLocalVideoReady(false);
    setRemoteVideoReady(false);
    setPipFlipped(false);
    setCameraFacing("user");

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
        uiMode,
        room,
        role,
        callId,
        callType,
      });

      startCallerTone();

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

  useEffect(() => {
    if (!room) return;
    if (role !== "caller") return;
    if (autoStarted) return;
    if (!sig) return; // wait until signaling is ready
    startCaller();
    setAutoStarted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, role, sig, autoStarted]);

  // ---- receiver actions ----

  async function acceptIncoming() {
    if (!sig || !room) return;
    setStarting(true);
    try {
      console.log("[CallSheet] acceptIncoming()", {
        uiMode,
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
      onEnd?.();
    } finally {
      setStarting(false);
    }
  }

  async function declineIncoming() {
    stopAllTones();
    await safeUpdateStatus("declined");
    await sendCallSummaryMessage("declined");
    cleanupPeer();
    onEnd?.();
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
    onEnd?.();
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
    const stream = localStreamRef.current || localRef.current?.srcObject;
    if (!stream) return;

    const videoTracks = stream.getVideoTracks();
    if (!videoTracks.length) return;

    videoTracks.forEach((t) => {
      t.enabled = !t.enabled;
      setCamOff(!t.enabled);
    });
  }

  async function switchCamera() {
    try {
      if (mode !== "video") return;
      if (!pc) return;

      const nextFacing = cameraFacing === "user" ? "environment" : "user";
      let newStream = null;

      const currentVideoTrack = localStreamRef.current
        ?.getVideoTracks?.()
        ?.at?.(0);
      const currentDeviceId =
        currentVideoTrack?.getSettings?.()?.deviceId || "";

      // First: try real facing-mode switch
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            ...getVideoConstraints(nextFacing),
            facingMode: { exact: nextFacing },
          },
        });
      } catch {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: getVideoConstraints(nextFacing),
          });
        } catch {
          const devices = await navigator.mediaDevices
            .enumerateDevices()
            .catch(() => []);

          const videoInputs = devices.filter((d) => d.kind === "videoinput");

          const alternateDevice = videoInputs.find(
            (d) => d.deviceId && d.deviceId !== currentDeviceId,
          );

          if (!alternateDevice?.deviceId) {
            throw new Error("No alternate camera device found");
          }

          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              ...getVideoConstraints(nextFacing),
              deviceId: { exact: alternateDevice.deviceId },
            },
          });
        }
      }

      const newVideoTrack = newStream.getVideoTracks?.()[0];
      if (!newVideoTrack) return;

      const sender = pc
        .getSenders()
        ?.find((s) => s.track && s.track.kind === "video");

      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }

      const currentStream = localStreamRef.current;

      if (currentStream) {
        const oldVideoTracks = currentStream.getVideoTracks();

        oldVideoTracks.forEach((t) => {
          try {
            currentStream.removeTrack(t);
          } catch {}
          try {
            t.stop();
          } catch {}
        });

        currentStream.addTrack(newVideoTrack);
        localStreamRef.current = currentStream;
      } else {
        localStreamRef.current = new MediaStream([newVideoTrack]);
      }

      setCameraFacing(nextFacing);
      setCamOff(false);
      setLocalVideoReady(false);

      if (localRef.current && localStreamRef.current) {
        localRef.current.srcObject = null;
        await attachStream(localRef.current, localStreamRef.current, {
          muted: true,
          kind: "local",
        });
      }
    } catch (e) {
      console.warn("[CallSheet] switchCamera failed:", e?.message || e);
    }
  }

  // ---------- render ----------

  if (!room) return null;

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

  const canShowRemote = remoteVideoReady;

  const showRemoteAsMain = canShowRemote && !pipFlipped;
  const showLocalAsMain = !canShowRemote || pipFlipped;

  const isDesktop =
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 768px)").matches;

  const miniStatusText = hasConnected
    ? formatDuration(elapsedSeconds)
    : statusText;

  const miniSurface =
    mode === "video" && remoteVideoReady && remoteStreamRef.current ? (
      <video
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover bg-black"
        ref={(el) => {
          if (!el || !remoteStreamRef.current) return;
          if (el.srcObject !== remoteStreamRef.current) {
            el.srcObject = remoteStreamRef.current;
          }
          el.muted = false;
          el.play?.().catch(() => {});
        }}
      />
    ) : mode === "video" && localVideoReady && localStreamRef.current ? (
      <video
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover bg-black"
        ref={(el) => {
          if (!el || !localStreamRef.current) return;
          if (el.srcObject !== localStreamRef.current) {
            el.srcObject = localStreamRef.current;
          }
          el.muted = true;
          el.play?.().catch(() => {});
        }}
      />
    ) : peerAvatar ? (
      <img
        src={peerAvatar}
        alt={displayPeerName}
        className="absolute inset-0 w-full h-full object-cover"
      />
    ) : (
      <div className="absolute inset-0 flex items-center justify-center text-5xl text-white bg-zinc-900">
        {displayPeerName.slice(0, 1).toUpperCase()}
      </div>
    );

  const shellClass = isExpanded
    ? "fixed inset-0 z-50 bg-black md:bg-black/70 md:backdrop-blur-[2px] flex md:items-center md:justify-center"
    : "hidden";

  const panelClass = isDesktop
    ? "relative w-[min(760px,84vw)] h-[min(760px,84vh)] bg-black border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden"
    : "relative w-full h-full bg-black border-0 rounded-none overflow-hidden";

  const bodyClass = isDesktop
    ? "relative bg-black overflow-hidden h-[calc(100%-64px)]"
    : "relative bg-black overflow-hidden h-[calc(100vh-64px)]";

  const mainVideoClass = isDesktop
    ? "absolute inset-0 w-full h-full bg-black object-contain z-10"
    : "absolute inset-0 w-full h-full bg-black object-cover z-10";

  const pipClass = isDesktop
    ? "absolute bottom-28 right-6 w-40 h-52 rounded-2xl border border-zinc-300 shadow-lg overflow-hidden bg-black z-20"
    : "absolute bottom-28 right-4 w-24 h-32 rounded-2xl border border-zinc-300 shadow-lg overflow-hidden bg-black z-20";

  const localPreviewClass = isDesktop
    ? "absolute bottom-28 right-6 w-40 h-52 rounded-2xl border border-zinc-700 shadow-lg overflow-hidden bg-black z-20"
    : "absolute bottom-28 right-4 w-24 h-32 rounded-2xl border border-zinc-700 shadow-lg overflow-hidden bg-black z-20";

  if (!isExpanded) {
    if (isDesktop) {
      return (
        <div
          className="fixed z-[60] rounded-2xl border border-zinc-700 bg-black shadow-2xl overflow-hidden select-none"
          style={{
            left: desktopMiniRect.x,
            top: desktopMiniRect.y,
            width: desktopMiniRect.w,
            height: desktopMiniRect.h,
          }}
        >
          <div
            className="absolute top-0 left-0 right-0 h-10 flex items-center justify-between px-3 bg-black/70 backdrop-blur-sm cursor-move z-20"
            onMouseDown={(e) => {
              miniDragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                originX: desktopMiniRect.x,
                originY: desktopMiniRect.y,
              };
            }}
          >
            <div className="text-[11px] text-white">
              {mode === "video" ? "Video" : "Voice"}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMessage?.();
                }}
                className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white text-xs"
                title="Back to chat"
              >
                💬
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore?.();
                }}
                className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white text-xs"
                title="Restore"
              >
                ⤢
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  hangup();
                }}
                className="w-8 h-8 rounded-full bg-rose-600 flex items-center justify-center text-white text-xs"
                title="End call"
              >
                ✕
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onRestore}
            className="relative w-full h-full bg-zinc-950 text-left"
          >
            {miniSurface}

            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20" />

            <div className="absolute bottom-3 left-3 right-3 text-left z-10">
              <div className="text-xl font-semibold text-white truncate">
                <DisplayName
                  name={displayPeerName}
                  verified={!!peerVerified}
                  badgeClassName="w-4 h-4"
                />
              </div>
              <div className="text-sm text-emerald-400 mt-1">
                {miniStatusText}
              </div>
              <div className="text-[11px] text-zinc-300 mt-1">
                Tap to reopen
              </div>
            </div>

            {mode === "video" && localVideoReady && remoteVideoReady && (
              <div className="absolute bottom-4 right-4 w-14 h-20 rounded-2xl border border-white/20 bg-black/70 shadow-lg overflow-hidden z-10">
                <video
                  autoPlay
                  playsInline
                  muted
                  disablePictureInPicture
                  className="w-full h-full object-contain bg-black"
                  ref={(el) => {
                    if (!el || !localStreamRef.current) return;
                    if (el.srcObject !== localStreamRef.current) {
                      el.srcObject = localStreamRef.current;
                    }
                    el.muted = true;
                    el.play?.().catch(() => {});
                  }}
                />
              </div>
            )}
          </button>

          <div
            className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize z-20"
            onMouseDown={(e) => {
              e.stopPropagation();
              miniResizeRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                originW: desktopMiniRect.w,
                originH: desktopMiniRect.h,
              };
            }}
          >
            <div className="absolute bottom-1 right-1 w-3 h-3 border-r-2 border-b-2 border-zinc-400" />
          </div>
        </div>
      );
    }

    return (
      <div className="fixed bottom-24 right-4 z-[60] w-36 h-48 rounded-2xl border border-zinc-700 bg-black shadow-2xl overflow-hidden">
        <button
          type="button"
          onClick={onRestore}
          className="relative w-full h-full bg-zinc-950 text-left"
        >
          {miniSurface}

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />

          <div className="absolute top-2 left-2 right-2 flex items-start justify-between z-10">
            <div className="px-2 py-1 rounded-full bg-black/60 text-[10px] text-white">
              {mode === "video" ? "Video" : "Voice"}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMessage?.();
                }}
                className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white text-xs"
                title="Back to chat"
              >
                💬
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  hangup();
                }}
                className="w-8 h-8 rounded-full bg-rose-600 flex items-center justify-center text-white text-xs"
                title="End call"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="absolute bottom-2 left-2 right-2 text-left z-10">
            <div className="text-sm font-semibold text-white truncate">
              <DisplayName
                name={displayPeerName}
                verified={!!peerVerified}
                badgeClassName="w-4 h-4"
              />
            </div>
            <div className="text-[11px] text-emerald-400 mt-0.5">
              {miniStatusText}
            </div>
            <div className="text-[10px] text-zinc-300 mt-0.5">
              Tap to reopen
            </div>
          </div>

          {mode === "video" && localVideoReady && remoteVideoReady && (
            <div className="absolute bottom-3 right-3 w-10 h-14 rounded-xl border border-white/20 bg-black/70 shadow-lg overflow-hidden z-10">
              <video
                autoPlay
                playsInline
                muted
                disablePictureInPicture
                className="w-full h-full object-contain bg-black"
                ref={(el) => {
                  if (!el || !localStreamRef.current) return;
                  if (el.srcObject !== localStreamRef.current) {
                    el.srcObject = localStreamRef.current;
                  }
                  el.muted = true;
                  el.play?.().catch(() => {});
                }}
              />
            </div>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className={panelClass}>
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
            onClick={onClose}
            type="button"
          >
            Minimize
          </button>
        </div>

        {/* body: fixed height so nothing collapses */}
        <div className={bodyClass}>
          {/* VIDEO LAYOUT */}
          {mode === "video" && (
            <>
              {/* permanently mounted hidden bind targets */}
              <div className="absolute w-0 h-0 overflow-hidden pointer-events-none opacity-0">
                <video ref={localRef} autoPlay playsInline muted />
                <video ref={remoteRef} autoPlay playsInline />
              </div>

              {/* black base */}
              <div className="absolute inset-0 bg-black" />

              {/* main surface: local first, remote only when ready, real PiP swap */}
              {showRemoteAsMain ? (
                <video
                  autoPlay
                  playsInline
                  disablePictureInPicture
                  className={mainVideoClass}
                  ref={(el) => {
                    if (!el || !remoteStreamRef.current) return;
                    if (el.srcObject !== remoteStreamRef.current) {
                      el.srcObject = remoteStreamRef.current;
                    }
                    el.muted = false;
                    el.play?.().catch(() => {});
                  }}
                />
              ) : showLocalAsMain && localVideoReady ? (
                <video
                  autoPlay
                  playsInline
                  muted
                  disablePictureInPicture
                  className={mainVideoClass}
                  ref={(el) => {
                    if (!el || !localStreamRef.current) return;
                    if (el.srcObject !== localStreamRef.current) {
                      el.srcObject = localStreamRef.current;
                    }
                    el.muted = true;
                    el.play?.().catch(() => {});
                  }}
                />
              ) : (
                <div className="absolute inset-0 bg-black z-10" />
              )}

              <div className="absolute inset-0 bg-black/10 pointer-events-none z-10" />

              {/* top status */}
              <div className="absolute top-4 left-0 right-0 flex justify-center z-20 px-4">
                <div className="text-center">
                  <div className="text-white text-xl md:text-2xl font-semibold drop-shadow">
                    <DisplayName
                      name={displayPeerName}
                      verified={!!peerVerified}
                      badgeClassName="w-5 h-5"
                    />
                  </div>
                  <div className="text-white/80 text-sm mt-1">
                    {hasConnected ? formatDuration(elapsedSeconds) : statusText}
                  </div>
                </div>
              </div>

              {/* before remote is ready, show only small local preview */}
              {localVideoReady && !remoteVideoReady && (
                <div className={localPreviewClass}>
                  <video
                    autoPlay
                    playsInline
                    muted
                    disablePictureInPicture
                    className="w-full h-full object-cover bg-black"
                    ref={(el) => {
                      if (!el || !localStreamRef.current) return;
                      if (el.srcObject !== localStreamRef.current) {
                        el.srcObject = localStreamRef.current;
                      }
                      el.muted = true;
                      el.play?.().catch(() => {});
                    }}
                  />
                </div>
              )}

              {/* once remote is ready, allow true main ↔ PiP swap */}
              {localVideoReady && remoteVideoReady && (
                <button
                  type="button"
                  className={pipClass}
                  onClick={() => setPipFlipped((v) => !v)}
                >
                  {showRemoteAsMain ? (
                    <video
                      autoPlay
                      playsInline
                      disablePictureInPicture
                      className="w-full h-full object-cover bg-black"
                      ref={(el) => {
                        if (!el || !localStreamRef.current) return;
                        if (el.srcObject !== localStreamRef.current) {
                          el.srcObject = localStreamRef.current;
                        }
                        el.muted = true;
                        el.play?.().catch(() => {});
                      }}
                    />
                  ) : (
                    <video
                      autoPlay
                      playsInline
                      disablePictureInPicture
                      className="w-full h-full object-cover bg-black"
                      ref={(el) => {
                        if (!el || !remoteStreamRef.current) return;
                        if (el.srcObject !== remoteStreamRef.current) {
                          el.srcObject = remoteStreamRef.current;
                        }
                        el.muted = false;
                        el.play?.().catch(() => {});
                      }}
                    />
                  )}
                </button>
              )}
            </>
          )}

          {/* AUDIO LAYOUT */}
          {mode === "audio" && (
            <div className="flex flex-col items-center justify-center h-full px-6">
              <div className="w-28 h-28 md:w-36 md:h-36 rounded-full mb-4 border-4 border-emerald-500/60 shadow-[0_0_40px_rgba(16,185,129,0.4)] flex items-center justify-center overflow-hidden bg-zinc-900">
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
              <div className="mt-4 flex flex-col items-center gap-1 text-center">
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
          <div className="absolute inset-x-0 bottom-4 md:bottom-5 flex flex-col items-center gap-3 z-30 px-4">
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

            <div className="flex items-center justify-center gap-6 text-zinc-400 text-xl bg-black/55 backdrop-blur-sm border border-zinc-800 rounded-full px-5 py-3">
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
                <>
                  <button
                    type="button"
                    onClick={toggleCam}
                    className={`hover:text-zinc-100 ${
                      camOff ? "text-rose-400" : ""
                    }`}
                    title="Turn camera on or off"
                  >
                    {camOff ? "📷✕" : "📷"}
                  </button>

                  <button
                    type="button"
                    onClick={switchCamera}
                    className="hover:text-zinc-100"
                    title="Switch front/back camera"
                  >
                    🔄
                  </button>
                </>
              )}

              {/* chat shortcut */}
              <button
                type="button"
                onClick={onMessage || onClose}
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
