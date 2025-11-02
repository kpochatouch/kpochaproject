// apps/web/src/pages/AwsLiveness.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaceLivenessDetector } from "@aws-amplify/ui-react-liveness";

// 👉 load AWS UI styles so the overlay looks right
import "@aws-amplify/ui-react/styles.css";
import "@aws-amplify/ui-react-liveness/styles.css";

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

  useEffect(() => {
    (async () => {
      try {
        // make sure Amplify knows about your identity pool
        ensureAwsConfigured();
        const cfg = getAwsLivenessConfig();
        setCfg({ region: cfg.region });

        // call your backend: POST /api/aws-liveness/session
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

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
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

  if (err) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
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

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
      <h1 className="text-xl font-semibold mb-4">AWS Liveness</h1>

      {/* give AWS enough width, keep centered */}
      <div className="w-full max-w-2xl mx-auto">
        <div className="aws-liveness">
          <FaceLivenessDetector
            sessionId={sessionId}
            region={region}
            onAnalysisComplete={handleComplete}
            onError={handleError}
          />
        </div>
      </div>

      <button
        onClick={() => nav(back)}
        className="mt-6 px-4 py-2 rounded bg-yellow-400 text-black text-sm"
      >
        Cancel
      </button>
    </div>
  );
}
