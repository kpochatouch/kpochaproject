// apps/web/src/components/VoiceInputButton.jsx
import { useEffect, useRef, useState } from "react";

function createRecognition() {
  if (typeof window === "undefined") return null;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = false; // keep simple: final text only
  rec.lang = navigator.language || "en-US";
  return rec;
}

/**
 * VoiceInputButton
 *
 * Props:
 * - onResult(transcript: string): called when user finishes speaking
 * - disabled?: boolean
 */
export default function VoiceInputButton({ onResult, disabled = false }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const recognitionRef = useRef(null);
  const timerRef = useRef(null);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    const rec = createRecognition();
    if (!rec) {
      setSupported(false);
      return;
    }

    recognitionRef.current = rec;
    setSupported(true);

    rec.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const transcript = last[0]?.transcript?.trim();
      if (transcript && onResult) {
        onResult(transcript);
      }
    };

    rec.onerror = () => {
      setListening(false);
      clearTimer();
      setSeconds(0);
    };

    rec.onend = () => {
      setListening(false);
      clearTimer();
      setSeconds(0);
    };

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.stop();
        } catch {}
      }
      clearTimer();
    };
  }, [onResult]);

  function handleClick() {
    const rec = recognitionRef.current;
    if (!rec) return;

    // 🔴 If already listening → always stop, even if disabled just became true
    if (listening) {
      try {
        rec.stop();
      } catch {}
      setListening(false);
      clearTimer();
      setSeconds(0);
      return;
    }

    // Not listening yet → respect disabled flag
    if (disabled) return;

    try {
      rec.start();
      setListening(true);
      setSeconds(0);
      clearTimer();
      timerRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      console.warn("speech recognition start failed", e);
      setListening(false);
      clearTimer();
      setSeconds(0);
    }
  }

  if (!supported) return null; // hide if not supported

  const label = listening
    ? `🎙️ Listening ${seconds.toString().padStart(2, "0")}s`
    : "🎙️";

  return (
    <button
      type="button"
      onClick={handleClick}
      // allow stopping while listening even if disabled turned true
      disabled={!listening && disabled}
      className={`px-2 py-2 rounded-lg border border-zinc-800 text-xs sm:text-sm ${
        listening ? "bg-red-500 text-white" : "bg-zinc-900 text-zinc-200"
      }`}
      title={
        listening
          ? "Listening… tap to stop"
          : "Tap and speak – converts to text"
      }
    >
      {label}
    </button>
  );
}
