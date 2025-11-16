// apps/web/src/components/CallSheet.jsx
import { useEffect, useRef, useState } from "react";
import SignalingClient from "../lib/webrtc/SignalingClient";

export default function CallSheet({ room, me, open, onClose }) {
  const [sig, setSig] = useState(null);
  const [pc, setPc] = useState(null);
  const localRef = useRef(null);
  const remoteRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const s = new SignalingClient(room, me);
    setSig(s);
    return () => { s?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, room, me]);

  async function start() {
    const pcNew = new RTCPeerConnection({ iceServers: SignalingClient.buildIceServersFromEnv() });
    setPc(pcNew);

    // show local
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    stream.getTracks().forEach((t) => pcNew.addTrack(t, stream));
    if (localRef.current) localRef.current.srcObject = stream;

    // remote
    pcNew.ontrack = (ev) => {
      if (remoteRef.current) remoteRef.current.srcObject = ev.streams[0];
    };

    // ICE
    pcNew.onicecandidate = (ev) => {
      if (ev.candidate) sig?.emit("webrtc:ice", ev.candidate);
    };

    // signaling
    sig?.on("webrtc:offer", async (remoteSdp) => {
      await pcNew.setRemoteDescription(new RTCSessionDescription(remoteSdp));
      const answer = await pcNew.createAnswer();
      await pcNew.setLocalDescription(answer);
      sig.emit("webrtc:answer", answer);
    });

    sig?.on("webrtc:answer", async (remoteSdp) => {
      await pcNew.setRemoteDescription(new RTCSessionDescription(remoteSdp));
    });

    sig?.on("webrtc:ice", async (cand) => {
      try { await pcNew.addIceCandidate(cand); } catch {}
    });

    // act as caller (create offer)
    const offer = await pcNew.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pcNew.setLocalDescription(offer);
    sig?.emit("webrtc:offer", offer);
  }

  function hangup() {
    try { pc?.getSenders().forEach((s) => s.track?.stop()); } catch {}
    try { pc?.close(); } catch {}
    onClose?.();
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-950 w-full max-w-3xl rounded-2xl p-4 space-y-3 border border-zinc-800">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Live Call</h3>
          <button className="text-sm px-3 py-1 rounded-lg border border-zinc-700" onClick={hangup}>Close</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <video ref={localRef} autoPlay playsInline muted className="w-full rounded-xl bg-black border border-zinc-800" />
          <video ref={remoteRef} autoPlay playsInline className="w-full rounded-xl bg-black border border-zinc-800" />
        </div>
        <div className="flex gap-3">
          <button className="px-4 py-2 rounded-lg bg-gold text-black font-semibold" onClick={start}>Start</button>
          <button className="px-4 py-2 rounded-lg bg-rose-500 text-black font-semibold" onClick={hangup}>Hang Up</button>
        </div>
      </div>
    </div>
  );
}
