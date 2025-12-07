import { useEffect, useRef, useState } from "react";

function supportsAudioRecording() {
  if (typeof window === "undefined") return false;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false;
  }
  return typeof window.MediaRecorder !== "undefined";
}

/**
 * VoiceMessageButton
 *
 * Props:
 * - onRecorded(blob: Blob): called after successful recording
 * - disabled?: boolean
 */
export default function VoiceMessageButton({ onRecorded, disabled = false }) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const mediaStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    setSupported(supportsAudioRecording());

    return () => {
      try {
        recorderRef.current?.stop();
      } catch {}
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function startRecording() {
    if (!supportsAudioRecording() || disabled) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        if (onRecorded && blob.size > 0) {
          onRecorded(blob);
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
        }
        setRecording(false);
      };

      rec.start();
      setRecording(true);
    } catch (e) {
      console.warn("startRecording error", e);
      setRecording(false);
    }
  }

  function stopRecording() {
    try {
      recorderRef.current?.stop();
    } catch (e) {
      console.warn("stopRecording error", e);
      setRecording(false);
    }
  }

  function handleClick() {
    if (!supported || disabled) return;
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`px-2 py-2 rounded-lg border border-zinc-800 text-sm ${
        recording ? "bg-red-500 text-white" : "bg-zinc-900 text-zinc-200"
      }`}
      title={recording ? "Tap to stop recording" : "Tap to record voice message"}
    >
      {recording ? "🎧…" : "🎧"}
    </button>
  );
}
