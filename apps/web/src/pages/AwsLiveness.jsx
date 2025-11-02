// apps/web/src/pages/AwsLiveness.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaceLivenessDetector } from "@aws-amplify/ui-react-liveness";
import { api } from "../lib/api";
import {
  ensureAwsConfigured,
  getAwsLivenessConfig,
} from "../lib/awsLivenessClient";

export default function AwsLiveness() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const back = params.get("back") || "/become";

  const [sessionId, setSessionId] = useState("");
  const [{ region }, setCfg] = useState({ region: "" });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // 1) configure Amplify + 2) ask backend to create session
  useEffect(() => {
    (async () => {
      try {
        ensureAwsConfigured();
        const cfg = getAwsLivenessConfig();
        setCfg({ region: cfg.region });

        const { data } = await api.post("/api/aws-liveness/session", {});
        if (!data?.ok || !data.sessionId) {
          throw new Error(
            data?.error || "Failed to create AWS liveness session"
          );
        }

        setSessionId(data.sessionId);
        setLoading(false);
      } catch (e) {
        console.error("[AwsLiveness] start failed:", e);
        setErr(e?.message || "Could not start AWS liveness.");
        setLoading(false);
      }
    })();
  }, []);

  const handleComplete = (result) => {
    try {
      localStorage.setItem(
        "kpocha:livenessMetrics",
        JSON.stringify({
          ok: true,
          ts: Date.now(),
          sessionId,
          source: "aws",
          score: result?.confidence ?? null,
        })
      );
    } catch (_) {}
    nav(back);
  };

  const handleError = (e) => {
    console.error("[AwsLiveness] detector error:", e);
    setErr(e?.message || "Liveness failed. Please try again.");
  };

  // loading screen – cover whole app so navbar/footer don't show
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black text-white flex flex-col items-center justify-center z-[999]">
        <h1 className="text-xl font-semibold mb-2">AWS Liveness</h1>
        <p className="text-sm text-zinc-300 mb-2">
          Preparing your liveness session…
        </p>
        <button
          onClick={() => nav(back)}
          className="mt-6 px-4 py-2 rounded bg-yellow-400 text-black text-sm"
        >
          Back
        </button>
      </div>
    );
  }

  // error screen – same thing, full cover
  if (err) {
    return (
      <div className="fixed inset-0 bg-black text-white flex flex-col items-center justify-center z-[999]">
        <h1 className="text-xl font-semibold mb-2">AWS Liveness</h1>
        <p className="text-sm text-red-400 mb-4">{err}</p>
        <button
          onClick={() => nav(back)}
          className="mt-6 px-4 py-2 rounded bg-yellow-400 text-black text-sm"
        >
          Back
        </button>
      </div>
    );
  }

  // ✅ success state – let AWS take the space
  return (
    <div className="fixed inset-0 bg-black text-white z-[999] flex flex-col">
      <div className="flex-1 aws-liveness-shell">
        <FaceLivenessDetector
          sessionId={sessionId}
          region={region}
          onAnalysisComplete={handleComplete}
          onError={handleError}
        />
      </div>
      <div className="p-3 bg-black/60 flex justify-center">
        <button
          onClick={() => nav(back)}
          className="px-4 py-2 rounded bg-yellow-400 text-black text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
