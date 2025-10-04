import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (user) nav("/browse");
  }, [user, nav]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      nav("/browse");
    } catch (e) {
      setErr(e.message || "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setErr("");
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
      nav("/browse");
    } catch (e) {
      setErr(e.message || "Google sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-10">
      <h2 className="text-2xl font-semibold mb-4">Sign in</h2>
      {err && <div className="text-red-400 text-sm mb-3">{err}</div>}
      <form className="space-y-3" onSubmit={submit}>
        <input
          placeholder="Email"
          value={email}
          onChange={e=>setEmail(e.target.value)}
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={e=>setPassword(e.target.value)}
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
        />
        <button
          disabled={busy}
          className="rounded-lg bg-gold text-black px-4 py-2 font-semibold w-full disabled:opacity-60"
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
        <Link to="/signup" className="text-gold underline">Create one</Link>
      </p>
    </div>
  );
}
