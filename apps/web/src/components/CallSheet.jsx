// apps/web/src/components/CallSheet.jsx
import { useEffect, useRef, useState } from "react";
import SignalingClient from "../lib/webrtc/SignalingClient";

export default function CallSheet({ room, me, open, onClose }) {
  const [sig, setSig] = useState(null);
  const [pc, setPc] = useState(null);
  const [mode, setMode] = useState("video"); // "audio" | "video"
  const [starting, setStarting] = useState(false);

  const localRef = useRef(null);
  const remoteRef = useRef(null);

  // setup signaling when modal opens
  useEffect(() => {
    if (!open || !room) return;
    const s = new SignalingClient(room, me);
    setSig(s);
    return () => {
      try {
        s?.disconnect();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, room, me]);

  async function start() {
    if (!sig || !room) return;
    setStarting(true);
    try {
      const wantVideo = mode === "video";

      const pcNew = new RTCPeerConnection({
        iceServers: SignalingClient.buildIceServersFromEnv(),
      });
      setPc(pcNew);

      // local media: audio-only OR audio+video
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
        if (ev.candidate) sig?.emit("webrtc:ice", ev.candidate);
      };

      // signaling listeners
      sig?.on("webrtc:offer", async (remoteSdp) => {
        await pcNew.setRemoteDescription(
          new RTCSessionDescription(remoteSdp)
        );
        const answer = await pcNew.createAnswer();
        await pcNew.setLocalDescription(answer);
        sig.emit("webrtc:answer", answer);
      });

      sig?.on("webrtc:answer", async (remoteSdp) => {
        await pcNew.setRemoteDescription(
          new RTCSessionDescription(remoteSdp)
        );
      });

      sig?.on("webrtc:ice", async (cand) => {
        try {
          await pcNew.addIceCandidate(cand);
        } catch {}
      });

      // act as caller (create offer)
      const offer = await pcNew.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: wantVideo,
      });
      await pcNew.setLocalDescription(offer);
      sig?.emit("webrtc:offer", offer);
    } catch (e) {
      console.error("call start error:", e);
      alert("Could not start call. Check your microphone/camera permissions.");
    } finally {
      setStarting(false);
    }
  }

  function hangup() {
    try {
      if (pc) {
        pc.getSenders().forEach((s) => s.track?.stop());
        pc.close();
      }
    } catch {}
    setPc(null);
    try {
      sig?.disconnect();
    } catch {}
    onClose?.();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-950 w-full max-w-3xl rounded-2xl p-4 space-y-3 border border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Live Call</h3>
            <p className="text-xs text-zinc-500">
              {mode === "audio"
                ? "Audio-only in-app call"
                : "Video call (with audio)"}
            </p>
          </div>
          <button
            className="text-sm px-3 py-1 rounded-lg border border-zinc-700"
            onClick={hangup}
          >
            Close
          </button>
        </div>

        {/* Mode selector */}
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

        <div className="flex gap-3">
          <button
            className="px-4 py-2 rounded-lg bg-gold text-black font-semibold disabled:opacity-50"
            onClick={start}
            disabled={starting}
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
          >
            Hang Up
          </button>
        </div>
      </div>
    </div>
  );
}
