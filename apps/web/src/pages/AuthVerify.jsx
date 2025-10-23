// apps/web/src/pages/AuthVerify.jsx
import { useEffect, useState } from "react";
import { applyActionCode } from "firebase/auth";
import { auth } from "../lib/firebase";
import { Link } from "react-router-dom";

export default function AuthVerify() {
  const [state, setState] = useState({ status: "checking", message: "Verifying…" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const oobCode = params.get("oobCode");

    if (mode !== "verifyEmail" || !oobCode) {
      setState({ status: "error", message: "Invalid verification link." });
      return;
    }

    (async () => {
      try {
        await applyActionCode(auth, oobCode);
        await auth.currentUser?.reload();
        setState({ status: "ok", message: "Email verified! You can continue." });
      } catch (e) {
        setState({
          status: "error",
          message: e?.message || "Verification failed. Your link may have expired.",
        });
      }
    })();
  }, []);

  if (state.status === "checking") return <div className="p-6">{state.message}</div>;
  if (state.status === "ok")
    return (
      <div className="p-6">
        <div className="text-emerald-400">{state.message}</div>
        <div className="mt-3">
          <Link className="underline text-gold" to="/browse">Go to app</Link>
        </div>
      </div>
    );

  return (
    <div className="p-6">
      <div className="text-red-400">{state.message}</div>
      <div className="mt-3">
        <Link className="underline text-gold" to="/login">Back to sign in</Link>
      </div>
    </div>
  );
}
