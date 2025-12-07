import { useEffect, useRef, useState } from "react";

function createRecognition() {
  if (typeof window === "undefined") return null;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;

  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = false;
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
  const recognitionRef = useRef(null);

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
    };

    rec.onend = () => {
      setListening(false);
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
    };
  }, [onResult]);

  function handleClick() {
    if (!recognitionRef.current || disabled) return;

    // Stop if already recording
    if (listening) {
      try {
        recognitionRef.current.stop();
      } catch {}
      return;
    }

    try {
      recognitionRef.current.start();
      setListening(true);
    } catch (e) {
      console.warn("speech recognition start failed", e);
      setListening(false);
    }
  }

  if (!supported) return null; // hide if not supported

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`px-2 py-2 rounded-lg border border-zinc-800 text-sm ${
        listening ? "bg-red-500 text-white" : "bg-zinc-900 text-zinc-200"
      }`}
      title={listening ? "Tap to stop listening" : "Tap and speak"}
    >
      {listening ? "🎙️…" : "🎙️"}
    </button>
  );
}
