// apps/web/src/pages/Signup.jsx
import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  reload,
  signOut,
} from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import PasswordInput from "../components/PasswordInput";
import { api, setAuthToken } from "../lib/api";

export default function Signup() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(""); // optional, cached locally
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  // NEW: step gating — "form" -> "verify"
  const [step, setStep] = useState("form");
  const [verificationEmailSent, setVerificationEmailSent] = useState(false);

  const { user } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    // Only auto-redirect if the user is verified
    if (user?.emailVerified) {
      nav("/browse");
      return;
    }
    // prefill from cache if present
    try {
      const cached = JSON.parse(localStorage.getItem("profileDraft") || "{}");
      if (cached.name) setName(cached.name);
      if (cached.phone) setPhone(cached.phone);
      if (cached.email) setEmail(cached.email);
    } catch {}
  }, [user, nav]);

  function cacheDraft(next) {
    try {
      const current = { name, phone, email, ...next };
      localStorage.setItem("profileDraft", JSON.stringify(current));
    } catch {}
  }

  async function routeAfterVerified() {
    try {
      // if username already set, go to browse; else go pick username
      const me = await api.get("/api/profile/me").then((r) => r.data).catch(() => null);
      const hasUsername = !!me?.username || !!me?.usernameLC;
      nav(hasUsername ? "/browse" : "/client-register", { replace: true });
    } catch {
      nav("/browse", { replace: true });
    }
  }

  // 🔐 Require email verification before proceeding
  async function submit(e) {
    e.preventDefault();
    setErr("");
    setOk("");

    if (!email.trim()) return setErr("Email is required.");
    if (password.length < 6) return setErr("Password must be at least 6 characters.");
    if (password !== confirm) return setErr("Passwords do not match.");

    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);

      // Set display name if provided (non-blocking)
      if (name.trim()) {
        await updateProfile(cred.user, { displayName: name.trim() });
      }

      // Send verification email (required)
      try {
        await sendEmailVerification(cred.user, {
          url: `${window.location.origin}/auth/verify`, // optional handler route
        });
        setVerificationEmailSent(true);
      } catch (e) {
        // If this fails, we still gate the flow; user can retry from the verify screen
        console.warn("sendEmailVerification failed:", e);
      }

      // Cache lightweight profile for later forms (local only)
      cacheDraft({});

      // Move to verify step; DO NOT set auth token or navigate yet
      setOk("We sent a verification email. Please check your inbox (and spam).");
      setStep("verify");
    } catch (e) {
      setErr(e?.message || "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setErr("");
    setOk("");
    try {
      if (!auth.currentUser) throw new Error("Please sign in again.");
      await sendEmailVerification(auth.currentUser, {
        url: `${window.location.origin}/auth/verify`,
      });
      setVerificationEmailSent(true);
      setOk("Verification email re-sent.");
    } catch (e) {
      setErr(e?.message || "Could not resend verification email.");
    }
  }

  async function recheckNow() {
    setErr("");
    setOk("");
    try {
      if (!auth.currentUser) throw new Error("Please sign in again.");
      await reload(auth.currentUser);
      if (!auth.currentUser.emailVerified) {
        setErr("Not verified yet. Please click the link in your email and try again.");
        return;
      }

      // ✅ Now the user is verified — fetch token, seed profile, and continue
      try {
        const tok = await auth.currentUser.getIdToken(true);
        setAuthToken(tok);
      } catch {}

      // Seed profile with name/phone if available (optional)
      try {
        await api.put("/api/profile/me", {
          displayName: name?.trim() || undefined,
          identity: { phone: phone?.trim() || undefined },
        });
      } catch {}

      // Clear draft cache
      cacheDraft({});

      await routeAfterVerified();
    } catch (e) {
      setErr(e?.message || "Could not verify status. Please try again.");
    }
  }

  async function useDifferentEmail() {
    try {
      await signOut(auth);
    } catch {}
    setStep("form");
    setOk("");
    setErr("");
  }

  // ---------- UI ----------
  if (step === "verify") {
    return (
      <div className="max-w-sm mx-auto px-4 py-10">
        <h2 className="text-2xl font-semibold mb-2">Verify your email</h2>

        {err && <div className="text-red-400 text-sm mb-3">{err}</div>}
        {ok && <div className="text-green-400 text-sm mb-3">{ok}</div>}

        <p className="text-sm text-zinc-300 mb-4">
          We sent a verification link to <span className="font-medium">{auth.currentUser?.email}</span>. 
          Open that email and click the link, then come back and press{" "}
          <span className="font-medium">“I’ve verified, re-check”</span>.
        </p>

        <div className="space-y-2">
          <button
            onClick={recheckNow}
            className="rounded-lg bg-[#d4af37] text-black px-4 py-2 font-semibold w-full"
          >
            I’ve verified, re-check
          </button>

          <button
            onClick={resendVerification}
            className="rounded-lg border border-zinc-700 px-4 py-2 font-semibold w-full"
          >
            Resend verification email
          </button>

          <button
            onClick={useDifferentEmail}
            className="rounded-lg border border-zinc-700 px-4 py-2 font-semibold w-full"
          >
            Use a different email
          </button>
        </div>

        {verificationEmailSent && (
          <p className="text-xs text-zinc-500 mt-3">
            Tip: Check your spam folder if you don’t see the email.
          </p>
        )}
      </div>
    );
  }

  // step === "form"
  return (
    <div className="max-w-sm mx-auto px-4 py-10">
      <h2 className="text-2xl font-semibold mb-4">Create account</h2>
      {err && <div className="text-red-400 text-sm mb-3">{err}</div>}
      {ok && <div className="text-green-400 text-sm mb-3">{ok}</div>}

      <form className="space-y-3" onSubmit={submit}>
        <input
          placeholder="Full name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            cacheDraft({ name: e.target.value });
          }}
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          autoComplete="name"
        />

        <input
          placeholder="Phone (optional)"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            cacheDraft({ phone: e.target.value });
          }}
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          autoComplete="tel"
          inputMode="tel"
        />

        <input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            cacheDraft({ email: e.target.value });
          }}
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          autoComplete="email"
          required
        />

        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="new-password"
        />

        <PasswordInput
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          autoComplete="new-password"
        />

        <button
          disabled={busy}
          className="rounded-lg bg-[#d4af37] text-black px-4 py-2 font-semibold w-full disabled:opacity-60"
        >
          {busy ? "Please wait..." : "Sign up"}
        </button>
      </form>

      <p className="text-sm text-zinc-400 mt-4">
        Already have an account?{" "}
        <Link to="/login" className="text-[#d4af37] underline">
          Sign in
        </Link>
      </p>

      <p className="text-sm text-zinc-400 mt-2">
        Prefer phone only?{" "}
        <Link to="/login/phone" className="text-[#d4af37] underline">
          Use phone sign-in
        </Link>
      </p>
    </div>
  );
}
