import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useMe } from "../context/MeContext.jsx";

export default function VerificationReminder() {
  const { isPro } = useMe();
  const [verified, setVerified] = useState(null);

  useEffect(() => {
    if (!isPro) {
      setVerified(null);
      return;
    }

    let alive = true;
    api
      .get("/api/face/me")
      .then(({ data }) => {
        if (!alive) return;
        const face = data?.face || {};
        setVerified(Boolean(face.enrolledAssetId && face.lastStatus === "match"));
      })
      .catch(() => alive && setVerified(false));

    return () => {
      alive = false;
    };
  }, [isPro]);

  if (!isPro || verified !== false) return null;

  return (
    <aside className="mx-auto mt-3 w-full max-w-6xl px-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-3 text-sm">
        <p className="text-zinc-100">
          Your Pro verification is incomplete. Complete face verification to
          help build trust and unlock verification-protected actions.
        </p>
        <Link
          to="/settings"
          className="shrink-0 rounded-md bg-yellow-400 px-3 py-1.5 font-semibold text-black"
        >
          Verify now
        </Link>
      </div>
    </aside>
  );
}
