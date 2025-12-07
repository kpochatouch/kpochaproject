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
 */
export default function CallSheet({
  room,
  me,
  open,
  onClose,
  role = "caller",
  callId = null,
  callType = "audio",
}) {
  const [sig, setSig] = useState(null);
  const [pc, setPc] = useState(null);
  const [mode, setMode] = useState(callType || "audio"); // "audio" | "video"
  const [starting, setStarting] = useState(false);
  const [hasConnected, setHasConnected] = useState(false);

  const localRef = useRef(null);
  const remoteRef = useRef(null);

  // keep mode in sync with callType when prop changes
  useEffect(() => {
    setMode(callType || "audio");
  }, [callType]);

  // setup signaling when modal opens
  useEffect(() => {
    if (!open || !room) return;

    const sc = new SignalingClient(room, role === "caller" ? "caller" : "receiver");
    sc.connect();
    setSig(sc);

    return () => {
      try {
        sc.disconnect();
      } catch {}
      setSig(null);
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
      if (st === "connected") setHasConnected(true);
      if (["disconnected", "failed", "closed"].includes(st)) {
        // you *could* auto-clean here if you want
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
      await setupPeerConnection(true);
      // optional: mark as "ringing"
      await safeUpdateStatus("ringing");
    } catch (e) {
      console.error("call start error:", e);
      alert("Could not start call. Check your microphone/camera permissions.");
    } finally {
      setStarting(false);
    }
  }

  // ---- receiver actions ----

  async function acceptIncoming() {
    if (!sig || !room) return;
    setStarting(true);
    try {
      await safeUpdateStatus("accepted");
      await setupPeerConnection(false); // wait for caller's offer
    } catch (e) {
      console.error("accept call failed:", e);
      alert("Could not accept call. Check your microphone/camera permissions.");
      // if it fails, mark declined
      await safeUpdateStatus("declined", { reason: "media_error" });
      onClose?.();
    } finally {
      setStarting(false);
    }
  }

  async function declineIncoming() {
    await safeUpdateStatus("declined");
    cleanupPeer();
    onClose?.();
  }

  // ---- hangup (both roles) ----

  async function hangup() {
    // pick status depending on whether call ever connected
    const endedStatus =
      hasConnected ? "ended" : role === "caller" ? "cancelled" : "declined";

    await safeUpdateStatus(endedStatus);
    cleanupPeer();
    onClose?.();
  }

  if (!open || !room) return null;

  const isCaller = role === "caller";
  const isReceiver = !isCaller;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-950 w-full max-w-3xl rounded-2xl p-4 space-y-3 border border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              {isCaller ? "Calling…" : "Incoming Call"}
            </h3>
            <p className="text-xs text-zinc-500">
              {mode === "audio"
                ? "Audio-only in-app call"
                : "Video call (with audio)"}
            </p>
          </div>
          <button
            className="text-sm px-3 py-1 rounded-lg border border-zinc-700"
            onClick={hangup}
            type="button"
          >
            Close
          </button>
        </div>

        {/* Mode selector → only for caller (receiver uses whatever caller chose) */}
        {isCaller && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400">Call type:</span>
            <button
              type="button"
              onClick={() => setMode("audio")}
              className={`px-3 py-1 rounded-full border text-xs ${
                mode === "audio"
                  ? "border-emerald-500 text-emerald-300 bg-emerald-900/20"
                  : "border-zinc-700 text-zinc-300"
              }`}
            >
              Audio only
            </button>
            <button
              type="button"
              onClick={() => setMode("video")}
              className={`px-3 py-1 rounded-full border text-xs ${
                mode === "video"
                  ? "border-sky-500 text-sky-300 bg-sky-900/20"
                  : "border-zinc-700 text-zinc-300"
              }`}
            >
              Video
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-xl bg-black border border-zinc-800"
          />
          <video
            ref={remoteRef}
            autoPlay
            playsInline
            className="w-full rounded-xl bg-black border border-zinc-800"
          />
        </div>

        {/* Controls differ for caller vs receiver */}
        <div className="flex gap-3">
          {isCaller ? (
            <>
              <button
                className="px-4 py-2 rounded-lg bg-gold text-black font-semibold disabled:opacity-50"
                onClick={startCaller}
                disabled={starting}
                type="button"
              >
                {starting
                  ? "Connecting…"
                  : mode === "audio"
                  ? "Start Audio Call"
                  : "Start Video Call"}
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-rose-500 text-black font-semibold"
                onClick={hangup}
                type="button"
              >
                Hang Up
              </button>
            </>
          ) : !pc ? (
            <>
              <button
                className="px-4 py-2 rounded-lg bg-emerald-500 text-black font-semibold disabled:opacity-50"
                onClick={acceptIncoming}
                disabled={starting}
                type="button"
              >
                {starting ? "Connecting…" : "Accept"}
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-rose-500 text-black font-semibold"
                onClick={declineIncoming}
                type="button"
              >
                Decline
              </button>
            </>
          ) : (
            <button
              className="px-4 py-2 rounded-lg bg-rose-500 text-black font-semibold"
              onClick={hangup}
              type="button"
            >
              Hang Up
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
