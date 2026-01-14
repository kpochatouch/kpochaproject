// apps/web/src/components/VoiceMessageButton.jsx
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
  const [seconds, setSeconds] = useState(0);

  const mediaStreamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    setSupported(supportsAudioRecording());

    return () => {
      try {
        recorderRef.current?.stop();
      } catch {}
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      clearTimer();
    };
  }, []);

  async function startRecording() {
    if (!supportsAudioRecording()) return;
    if (recording) return;

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
        clearTimer();
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
        setSeconds(0);
      };

      rec.onerror = (e) => {
        console.warn("MediaRecorder error", e);
        clearTimer();
        setRecording(false);
        setSeconds(0);
        try {
          rec.stop();
        } catch {}
      };

      rec.start();
      setRecording(true);
      setSeconds(0);
      clearTimer();
      timerRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      console.warn("startRecording error", e);
      clearTimer();
      setRecording(false);
      setSeconds(0);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
    }
  }

  function stopRecording() {
    clearTimer();
    setSeconds((s) => s); // no-op, just ensures state is stable
    try {
      recorderRef.current?.stop();
    } catch (e) {
      console.warn("stopRecording error", e);
      setRecording(false);
      setSeconds(0);
    }
  }

  function handleClick() {
    if (!supported) return;

    // 🔴 If already recording, always stop – even if disabled just became true
    if (recording) {
      stopRecording();
      return;
    }

    // Not recording yet → respect disabled
    if (disabled) return;

    startRecording();
  }

  if (!supported) return null;

  const label = recording ? `🎧 ${seconds.toString().padStart(2, "0")}s` : "🎧";

  return (
    <button
      type="button"
      onClick={handleClick}
      // allow stopping while recording even if disabled turned true
      disabled={!recording && disabled}
      className={`px-2 py-2 rounded-lg border border-zinc-800 text-xs sm:text-sm ${
        recording ? "bg-red-500 text-white" : "bg-zinc-900 text-zinc-200"
      }`}
      title={
        recording ? "Recording… tap to stop" : "Tap to record a voice message"
      }
    >
      {label}
    </button>
  );
}
