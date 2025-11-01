// apps/web/src/pages/AwsLiveness.jsx
import React, { useEffect, useState } from "react";
import { FaceLivenessDetector } from "@aws-amplify/ui-react-liveness";
import { ThemeProvider } from "@aws-amplify/ui-react";
import { Amplify } from "aws-amplify";
import awsconfig from "../lib/aws-exports.js"; // ✅ fixed path
import { api } from "../lib/api";
import { useNavigate } from "react-router-dom";

// ✅ Configure Amplify once
Amplify.configure({
  Auth: {
    identityPoolId: awsconfig.aws_cognito_identity_pool_id,
    region: awsconfig.aws_project_region,
  },
  aws_project_region: awsconfig.aws_project_region,
});

export default function AwsLiveness() {
  const nav = useNavigate();
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // ✅ Request backend to start AWS Rekognition liveness session
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.post("/api/aws/liveness/session", {
          reason: "onboarding",
        });
        setSessionId(data.sessionId);
      } catch (e) {
        console.error(e);
        setErr("Cannot start AWS liveness right now.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ✅ Handle AWS analysis completion
  async function handleDone() {
    try {
      const { data } = await api.get(`/api/aws/liveness/session/${sessionId}`);
      const confidence = data?.aws?.Confidence ?? 0;
      if (confidence >= 80) {
        alert("Liveness passed ✅");
      } else {
        alert("Liveness too low, please try again.");
      }
    } catch (e) {
      console.error(e);
      alert("Could not read liveness result.");
    } finally {
      nav(-1);
    }
  }

  // ✅ Handle camera or AWS SDK errors
  function handleError(e) {
    console.error(e);
    alert("AWS liveness errored. Try again.");
    nav(-1);
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        <h1 className="text-xl font-semibold mb-4">AWS Face Liveness</h1>

        {loading ? (
          <div>Starting camera…</div>
        ) : err ? (
          <div className="text-red-400">{err}</div>
        ) : (
          <ThemeProvider>
            <FaceLivenessDetector
              sessionId={sessionId}
              region={awsconfig.aws_project_region}
              onAnalysisComplete={handleDone}
              onError={handleError}
            />
          </ThemeProvider>
        )}

        <button
          onClick={() => nav(-1)}
          className="mt-4 px-3 py-2 border border-yellow-400 rounded"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
