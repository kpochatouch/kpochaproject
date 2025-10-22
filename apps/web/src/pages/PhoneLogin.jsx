import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  onAuthStateChanged,
} from "firebase/auth";
import { auth } from "../lib/firebase";
import { api, setAuthToken } from "../lib/api";

export default function PhoneLogin() {
  const nav = useNavigate();
  const loc = useLocation();
  const qs = useMemo(() => new URLSearchParams(loc.search), [loc.search]);

  const [step, setStep] = useState("phone"); // phone | code
  const [phone, setPhone] = useState(""); // E.164 preferred (+2348...)
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  // create (or reuse) invisible recaptcha
  useEffect(() => {
    if (window._kpochaRecaptcha) return;
    try {
      window._kpochaRecaptcha = new RecaptchaVerifier(auth, "recaptcha-container", {
        size: "invisible",
      });
    } catch {
      // if already exists, fine
    }
  }, []);

  // if already signed in, redirect using the same username check
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return;
      try {
        const tok = await u.getIdToken(true);
        setAuthToken(tok);
      } catch {}
      await routeAfterUsernameCheck();
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function routeAfterUsernameCheck() {
    try {
      const me = await api.get("/api/profile/me").then(r => r.data).catch(() => null);
      const hasUsername = !!me?.username || !!me?.usernameLC;
      const next = qs.get("next") || "/browse";
      nav(hasUsername ? next : "/client-register", { replace: true });
    } catch {
      nav("/browse", { replace: true });
    }
  }

  async function sendCode(e) {
    e?.preventDefault?.();
    setErr("");
    if (!phone.trim()) return setErr("Enter your phone number.");
    setBusy(true);
    try {
      const conf = await signInWithPhoneNumber(
        auth,
        phone.trim(),
        window._kpochaRecaptcha
      );
      setConfirmation(conf);
      setStep("code");
    } catch (e) {
      setErr(e?.message || "Failed to send code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e) {
    e?.preventDefault?.();
    setErr("");
    if (!code.trim() || !confirmation) return;
    setBusy(true);
    try {
      await confirmation.confirm(code.trim());
      // onAuthStateChanged handler will finish the redirect
    } catch (e) {
      setErr(e?.message || "Invalid code.");
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-10">
      <div id="recaptcha-container" /> {/* invisible */}

      <h2 className="text-2xl font-semibold mb-2">
        {step === "phone" ? "Continue with Phone" : "Enter the code"}
      </h2>
      <p className="text-sm text-zinc-400 mb-4">
        {step === "phone"
          ? "We’ll text you a verification code."
          : "We sent a 6-digit code to your phone."}
      </p>

      {err && <div className="text-red-400 text-sm mb-3">{err}</div>}

      {step === "phone" && (
        <form onSubmit={sendCode} className="space-y-3">
          <input
            className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
            placeholder="+2348012345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
          />
          <button
            className="w-full rounded-lg bg-[#d4af37] text-black font-semibold px-4 py-2 disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Sending…" : "Send Code"}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode} className="space-y-3">
          <input
            className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
          />
          <button
            className="w-full rounded-lg bg-[#d4af37] text-black font-semibold px-4 py-2 disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Verifying…" : "Verify & Continue"}
          </button>

          <button
            type="button"
            onClick={() => { setStep("phone"); setCode(""); }}
            className="w-full rounded-lg border border-zinc-700 px-4 py-2"
          >
            Use a different number
          </button>
        </form>
      )}
    </div>
  );
}
