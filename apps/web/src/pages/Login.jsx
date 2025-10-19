import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  setPersistence,
  browserLocalPersistence,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import PasswordInput from "../components/PasswordInput";
import { setAuthToken } from "../lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);

  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const qs = useMemo(() => new URLSearchParams(loc.search), [loc.search]);

  // persist session in local storage for SPA
  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch(() => {});
    // clear google last state (avoids "popup_closed_by_user" loops)
    try { sessionStorage.removeItem("g_state"); } catch {}
    try { localStorage.removeItem("g_state"); } catch {}
  }, []);

  // if already signed in, go where they intended
  useEffect(() => {
    if (!user) return;
    const next = qs.get("next") || "/browse";
    nav(next, { replace: true });
  }, [user, nav, qs]);

  async function afterSignInRedirect() {
    try {
      // ensure ID token is available to axios interceptor
      const tok = await auth.currentUser.getIdToken(true);
      setAuthToken(tok);
    } catch {
      // fail-soft — interceptor may still pick it up from AuthContext if you store there
    }
    const next = qs.get("next") || "/browse";
    nav(next, { replace: true });
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      await afterSignInRedirect();
    } catch (e) {
      setErr(e?.message || "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setErr(""); setOk("");
    setBusy(true);
    try {
      googleProvider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, googleProvider);
      await afterSignInRedirect();
    } catch (e) {
      setErr(e?.message || "Google sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function doReset() {
    setErr(""); setOk("");
    if (!email.trim()) return setErr("Enter your email first to reset password.");
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setOk("Password reset email sent. Check your inbox.");
      setResetting(false);
    } catch (e) {
      setErr(e?.message || "Failed to send reset email");
    } finally {
      setBusy(false);
    }
  }

  const signedOut = qs.get("signedout") === "1";

  return (
    <div className="max-w-sm mx-auto px-4 py-10">
      <h2 className="text-2xl font-semibold mb-1">Sign in</h2>
      <p className="text-sm text-zinc-400 mb-4">
        {signedOut ? "You’ve been signed out." : "Use your email or Google account."}
      </p>

      {err && <div className="text-red-400 text-sm mb-3">{err}</div>}
      {ok && <div className="text-green-400 text-sm mb-3">{ok}</div>}

      <form className="space-y-3" onSubmit={submit}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          type="email"
          autoComplete="email"
          required
        />

        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className="bg-black"
        />

        <div className="flex items-center justify-between text-sm">
          <span />
          <button
            type="button"
            onClick={() => setResetting(true)}
            className="text-zinc-400 hover:text-white underline"
          >
            Forgot password?
          </button>
        </div>

        <button
          disabled={busy}
          className="rounded-lg bg-[#d4af37] text-black px-4 py-2 font-semibold w-full disabled:opacity-60"
        >
          {busy ? "Please wait..." : "Continue"}
        </button>
      </form>

      <button
        onClick={google}
        disabled={busy}
        className="mt-4 w-full rounded-lg border border-zinc-700 px-4 py-2 disabled:opacity-60"
      >
        Continue with Google
      </button>

      <p className="text-sm text-zinc-400 mt-4">
        No account?{" "}
        <Link to="/signup" className="text-[#d4af37] underline">Create one</Link>
      </p>

      {/* Simple inline reset panel (no extra page) */}
      {resetting && (
        <div className="mt-6 rounded-lg border border-zinc-800 p-3 bg-zinc-950">
          <p className="text-sm text-zinc-300 mb-2">
            We’ll send a reset link to <span className="text-white">{email || "(your email)"}</span>.
          </p>
          <div className="flex gap-2">
            <button
              onClick={doReset}
              disabled={busy || !email}
              className="px-3 py-2 rounded bg-white text-black disabled:opacity-60"
            >
              Send reset link
            </button>
            <button
              onClick={() => setResetting(false)}
              className="px-3 py-2 rounded border border-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
