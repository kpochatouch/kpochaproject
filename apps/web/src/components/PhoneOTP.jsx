import { useEffect, useRef, useState } from "react";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  linkWithCredential,
  PhoneAuthProvider,
} from "firebase/auth";
import { app } from "../lib/firebase"; // your existing Firebase init

/**
 * Reusable phone OTP component.
 * Props:
 *  - phone: string (E.164 or local; we only pass to Firebase as-is)
 *  - onVerified: (dateISO) => void   // called once verification succeeds
 *  - disabled: boolean
 */
export default function PhoneOTP({ phone, onVerified, disabled = false }) {
  const auth = getAuth(app);
  const recaptchaDivId = useRef(`recaptcha-${Math.random().toString(36).slice(2)}`);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  // setup invisible reCAPTCHA once
  useEffect(() => {
    if (!auth || !recaptchaDivId.current) return;
    if (window.__otpRecaptchaSetup) return;
    try {
      window.__otpRecaptchaSetup = new RecaptchaVerifier(auth, recaptchaDivId.current, {
        size: "invisible",
      });
    } catch {}
    // no cleanup — reused across page
  }, [auth]);

  async function sendCode() {
    try {
      setMsg("");
      if (!phone) {
        setMsg("Enter phone number first.");
        return;
      }
      setSending(true);

      // If user signed in by email, we link phone to their account;
      // otherwise we can just signInWithPhoneNumber (either works).
      const verifier = window.__otpRecaptchaSetup;
      const result = await signInWithPhoneNumber(auth, phone, verifier);
      setConfirm(result);
      setMsg("Code sent. Check your SMS.");
    } catch (e) {
      setMsg(e?.message || "Failed to send code.");
      setConfirm(null);
    } finally {
      setSending(false);
    }
  }

  async function verifyCode() {
    try {
      setMsg("");
      if (!confirm || !code) return;
      await confirm.confirm(code);

      // success — mark verified
      const when = new Date().toISOString();
      onVerified?.(when);
      setMsg("Phone verified ✅");
    } catch (e) {
      setMsg(e?.message || "Invalid code.");
    }
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <button
          type="button"
          onClick={sendCode}
          disabled={disabled || sending}
          className="text-xs px-2 py-1 rounded border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
          title="Send OTP"
        >
          {sending ? "Sending…" : "Verify phone via OTP"}
        </button>
        {msg && <div className="text-xs text-zinc-400 mt-1">{msg}</div>}

        {confirm && (
          <div className="mt-2 flex items-center gap-2">
            <input
              className="bg-black border border-zinc-800 rounded px-2 py-1 text-sm"
              placeholder="Enter 6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              type="button"
              onClick={verifyCode}
              className="text-xs px-2 py-1 rounded border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30"
            >
              Confirm
            </button>
          </div>
        )}
      </div>

      {/* Invisible reCAPTCHA anchor */}
      <div id={recaptchaDivId.current} />
    </div>
  );
}
