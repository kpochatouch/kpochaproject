// apps/web/src/components/PhoneOTP.jsx
import { useEffect, useRef, useState } from "react";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";
import { app } from "../lib/firebase";

/** Normalize Nigerian numbers to E.164 (+234). */
function toE164NG(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;

  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("234")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+234${digits.slice(1)}`;
  return `+234${digits.replace(/^0+/, "")}`;
}

/**
 * Props:
 *  - phone: string (raw user input)
 *  - onVerified: (dateISO: string) => void
 *  - disabled?: boolean
 */
export default function PhoneOTP({ phone, onVerified, disabled = false }) {
  const auth = getAuth(app);
  const recaptchaDivId = useRef(`recaptcha-${Math.random().toString(36).slice(2)}`);

  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [code, setCode] = useState("");

  const [msg, setMsg] = useState("");
  const [lastE164, setLastE164] = useState("");

  const [verified, setVerified] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState("");

  // If user edits the phone after verifying, reset the verified state.
  useEffect(() => {
    if (!phone) {
      setVerified(false);
      setVerifiedAt("");
      setConfirm(null);
      setCode("");
      return;
    }
    const asE164 = toE164NG(phone);
    if (verified && asE164 !== lastE164) {
      setVerified(false);
      setVerifiedAt("");
      setConfirm(null);
      setCode("");
      setMsg("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  // Setup a single invisible reCAPTCHA instance
  useEffect(() => {
    let verifier = window.__otpRecaptchaSetup;
    const ensure = () => {
      if (verifier) return verifier;
      try {
        verifier = new RecaptchaVerifier(getAuth(app), recaptchaDivId.current, {
          size: "invisible",
          callback: () => {},
          "expired-callback": () => {},
        });
        window.__otpRecaptchaSetup = verifier;
      } catch {
        // ignore; we’ll retry when sending
      }
      return verifier;
    };

    ensure();

    return () => {
      // Clean up only if this component created it and there are no other users.
      // Safer approach: if the element exists, try to clear.
      try {
        window.__otpRecaptchaSetup?.clear?.();
      } catch {}
      delete window.__otpRecaptchaSetup;
    };
  }, []);

  async function sendCode() {
    try {
      setMsg("");
      const e164 = toE164NG(phone);
      if (!e164 || e164.length < 8) {
        setMsg("Enter a valid Nigerian phone number.");
        return;
      }
      setSending(true);
      setLastE164(e164);

      let verifier = window.__otpRecaptchaSetup;
      if (!verifier) {
        try {
          verifier = new RecaptchaVerifier(getAuth(app), recaptchaDivId.current, { size: "invisible" });
          window.__otpRecaptchaSetup = verifier;
        } catch {
          setMsg("reCAPTCHA not ready. Refresh and try again.");
          return;
        }
      }

      const result = await signInWithPhoneNumber(auth, e164, verifier);
      setConfirm(result);
      setVerified(false);
      setVerifiedAt("");
      setMsg(`Code sent to ${e164}. Check your SMS.`);
    } catch (e) {
      const map = {
        "auth/invalid-phone-number": "Invalid phone number. Use a real Nigerian number.",
        "auth/too-many-requests": "Too many attempts. Please wait a bit and try again.",
        "auth/quota-exceeded": "SMS quota exceeded. Try again later.",
        "auth/missing-phone-number": "Enter a phone number first.",
        "auth/captcha-check-failed": "reCAPTCHA check failed. Refresh and try again.",
        "auth/network-request-failed": "Network error. Check your connection.",
        "auth/user-disabled": "This user is disabled.",
        "auth/billing-not-enabled": "SMS is disabled. Enable billing for Phone Auth.",
      };
      setMsg(map[e?.code] || e?.message || "Failed to send code.");
      setConfirm(null);
    } finally {
      setSending(false);
    }
  }

  async function verifyCode() {
    try {
      setMsg("");
      const trimmed = (code || "").replace(/\s/g, "");
      if (!confirm || trimmed.length < 6) {
        setMsg("Enter the 6-digit code.");
        return;
      }
      await confirm.confirm(trimmed);

      const when = new Date().toISOString();
      setVerified(true);
      setVerifiedAt(when);
      setConfirm(null);     // hide code UI after success
      setCode("");
      onVerified?.(when);
      setMsg("");
    } catch (e) {
      const map = {
        "auth/invalid-verification-code": "Invalid code. Double-check the 6 digits.",
        "auth/code-expired": "Code expired. Send a new one.",
      };
      setMsg(map[e?.code] || e?.message || "Invalid code.");
    }
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={sendCode}
            disabled={disabled || sending}
            className="text-xs px-2 py-1 rounded border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
            title="Send OTP"
          >
            {sending ? "Sending…" : (verified ? "Resend code" : "Verify phone via OTP")}
          </button>

          {verified && (
            <span className="text-xs px-2 py-1 rounded border border-emerald-700 text-emerald-300">
              ✅ Phone verified{lastE164 ? ` (${lastE164})` : "" }
            </span>
          )}
        </div>

        {msg && <div className="text-xs text-zinc-400 mt-1">{msg}</div>}

        {/* Only show the code UI while awaiting verification */}
        {!verified && confirm && (
          <div className="mt-2 flex items-center gap-2">
            <input
              className="bg-black border border-zinc-800 rounded px-2 py-1 text-sm"
              placeholder="Enter 6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
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

      {/* Invisible reCAPTCHA anchor (required for Web) */}
      <div id={recaptchaDivId.current} />
    </div>
  );
}
