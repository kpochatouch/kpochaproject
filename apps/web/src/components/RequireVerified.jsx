// apps/web/src/components/RequireVerified.jsx
import { useEffect, useState } from "react";
import { onAuthStateChanged, sendEmailVerification } from "firebase/auth";
import { auth } from "../lib/firebase";

export default function RequireVerified({ children }) {
  const [ready, setReady] = useState(false);
  const [verified, setVerified] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const off = onAuthStateChanged(auth, async (u) => {
      if (u) {
        try {
          await u.reload(); // make sure emailVerified is fresh
        } catch {}
        setVerified(!!auth.currentUser?.emailVerified);
      } else {
        setVerified(false);
      }
      setReady(true);
    });
    return off;
  }, []);

  if (!ready) return <div className="p-4">Loading…</div>;
  if (!verified) {
    return (
      <div className="p-4 border border-zinc-800 rounded-lg">
        <div className="mb-2">Please verify your email to continue.</div>
        <button
          className="px-3 py-2 border border-zinc-700 rounded"
          onClick={async () => {
            if (!auth.currentUser) return;
            try {
              await sendEmailVerification(auth.currentUser, {
                url: `${window.location.origin}/auth/verify`,
              });
              setMsg("Verification email sent.");
            } catch (e) {
              setMsg(e?.message || "Failed to send verification email.");
            } finally {
              setTimeout(() => setMsg(""), 2500);
            }
          }}
        >
          Resend verification email
        </button>
        {msg && <div className="text-xs text-zinc-500 mt-2">{msg}</div>}
      </div>
    );
  }
  return <>{children}</>;
}
