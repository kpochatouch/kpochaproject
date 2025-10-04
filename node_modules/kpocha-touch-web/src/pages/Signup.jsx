import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";

export default function Signup() {
  const [name, setName] = useState("");
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
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (name.trim()) {
        await updateProfile(cred.user, { displayName: name.trim() });
      }
      nav("/browse");
    } catch (e) {
      setErr(e.message || "Sign up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-10">
      <h2 className="text-2xl font-semibold mb-4">Create account</h2>
      {err && <div className="text-red-400 text-sm mb-3">{err}</div>}
      <form className="space-y-3" onSubmit={submit}>
        <input
          placeholder="Full name"
          value={name}
          onChange={e=>setName(e.target.value)}
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
        />
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
          {busy ? "Please wait..." : "Sign up"}
        </button>
      </form>

      <p className="text-sm text-zinc-400 mt-4">
        Already have an account?{" "}
        <Link to="/login" className="text-gold underline">Sign in</Link>
      </p>
    </div>
  );
}
