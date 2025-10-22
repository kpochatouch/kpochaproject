import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
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
  const { user } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (user) nav("/browse");
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

  async function afterSignupRoute() {
    try {
      // if username already set, go to browse; else go pick username
      const me = await api.get("/api/profile/me").then(r => r.data).catch(() => null);
      const hasUsername = !!me?.username || !!me?.usernameLC;
      nav(hasUsername ? "/browse" : "/client-register", { replace: true });
    } catch {
      nav("/browse", { replace: true });
    }
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setOk("");

    // light client-side checks
    if (!email.trim()) return setErr("Email is required.");
    if (password.length < 6) return setErr("Password must be at least 6 characters.");
    if (password !== confirm) return setErr("Passwords do not match.");

    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);

      // Set display name if provided
      if (name.trim()) {
        await updateProfile(cred.user, { displayName: name.trim() });
      }

      // store token for API calls immediately
      try {
        const tok = await cred.user.getIdToken(true);
        setAuthToken(tok);
      } catch {}

      // non-blocking verification email
      try {
        await sendEmailVerification(cred.user);
        setOk("Verification email sent. You can continue and verify later.");
      } catch {}

      // seed profile with name/phone if available (optional)
      try {
        await api.put("/api/profile/me", {
          displayName: name?.trim() || undefined,
          identity: { phone: phone?.trim() || undefined },
        });
      } catch {}

      // Cache lightweight profile so later forms can prefill
      cacheDraft({});

      await afterSignupRoute();
    } catch (e) {
      setErr(e?.message || "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-10">
      <h2 className="text-2xl font-semibold mb-4">Create account</h2>
      {err && <div className="text-red-400 text-sm mb-3">{err}</div>}
      {ok && <div className="text-green-400 text-sm mb-3">{ok}</div>}

      <form className="space-y-3" onSubmit={submit}>
        <input
          placeholder="Full name"
          value={name}
          onChange={(e) => { setName(e.target.value); cacheDraft({ name: e.target.value }); }}
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          autoComplete="name"
        />

        <input
          placeholder="Phone (optional)"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); cacheDraft({ phone: e.target.value }); }}
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          autoComplete="tel"
          inputMode="tel"
        />

        <input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); cacheDraft({ email: e.target.value }); }}
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
        <Link to="/login" className="text-[#d4af37] underline">Sign in</Link>
      </p>

      <p className="text-sm text-zinc-400 mt-2">
        Prefer phone only?{" "}
        <Link to="/login/phone" className="text-[#d4af37] underline">Use phone sign-in</Link>
      </p>
    </div>
  );
}
