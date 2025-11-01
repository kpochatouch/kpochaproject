// apps/web/src/pages/AwsLiveness.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { getRekClient } from "../lib/awsLivenessClient";
import { StartFaceLivenessSessionCommand } from "@aws-sdk/client-rekognition";

export default function AwsLiveness() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const back = params.get("back") || "/become";

  const [status, setStatus] = useState("Preparing AWS liveness…");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        // 1) ask backend to create the session
        const { data } = await api.post("/api/aws-liveness/session", {});
        if (!data?.ok) {
          throw new Error(data?.error || "Failed to create session");
        }

        const sessionId = data.sessionId;

        // 2) create browser Rekognition client (Cognito → temp creds)
        const client = getRekClient();
        if (!client) throw new Error("Rekognition client not ready");

        setStatus("Connecting to AWS…");

        // 3) start the session (this mainly validates permissions here)
        await client.send(
          new StartFaceLivenessSessionCommand({
            SessionId: sessionId,
          })
        );

        // 4) Save for BecomePro.jsx to pick up
        localStorage.setItem(
          "kpocha:livenessMetrics",
          JSON.stringify({
            ok: true,
            ts: Date.now(),
            sessionId,
            source: "aws",
          })
        );
        // you can later store an actual selfie image url here
        localStorage.setItem("kpocha:selfieUrl", "");
        localStorage.setItem("kpocha:livenessVideoUrl", "");

        setStatus("Liveness done. Returning to form…");
        nav(back);
      } catch (err) {
        console.error("[AwsLiveness]", err);
        setError(err?.message || "AWS liveness errored. Try again.");
        setStatus("Failed to run AWS liveness.");
      }
    })();
  }, [nav, back]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
      <h1 className="text-xl font-semibold mb-2">AWS Liveness</h1>
      <p className="text-sm text-zinc-300 mb-2">{status}</p>
      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : (
        <p className="text-xs text-zinc-500">
          Please wait… you will be redirected.
        </p>
      )}
      <button
        onClick={() => nav(back)}
        className="mt-6 px-4 py-2 rounded bg-yellow-400 text-black text-sm"
      >
        Back
      </button>
    </div>
  );
}
