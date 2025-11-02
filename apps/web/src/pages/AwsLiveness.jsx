// apps/web/src/pages/AwsLiveness.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaceLivenessDetector } from "@aws-amplify/ui-react-liveness";
import { api } from "../lib/api";
import {
  ensureAwsConfigured,
  getAwsLivenessConfig,
} from "../lib/awsLivenessClient";

// 👇 we are NOT importing the custom CSS here anymore
// import "../styles/";

// short, friendly text – your words, not AWS long warning
const DISPLAY_TEXT = {
  headingText: "Face verification",
  subheadingText: "Keep your face inside the oval and follow the line.",
  photosensitivityWarningHeadingText: "",
  photosensitivityWarningText: "",
  photosensitivityWarningInfoText: "",
  instructionsHeaderText: "",
  instructionsDescriptionText: "",
  instructionListText: [],
  challengeInProgressText: "Hold still…",
  challengeCompleteText: "Done",
  challengeFailedErrorText: "Repeat the movement as shown.",
  retryChallengeButtonText: "Try again",
  exitButtonText: "Close",
  recordingIndicatorText: "",
  livenessCheckText: "Verifying…",
};

export default function AwsLiveness() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const back = params.get("back") || "/become";

  const [sessionId, setSessionId] = useState("");
  const [region, setRegion] = useState("");
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");

  // 1. configure + create session
  useEffect(() => {
    (async () => {
      try {
        ensureAwsConfigured();
        const cfg = getAwsLivenessConfig();
        setRegion(cfg.region);

        const { data } = await api.post("/api/aws-liveness/session", {});
        if (!data?.ok || !data.sessionId) {
          throw new Error("Could not start face verification.");
        }

        setSessionId(data.sessionId);
        setReady(true);
      } catch (e) {
        console.error("[AwsLiveness] init failed:", e);
        setErr(e?.message || "Could not start face verification.");
      }
    })();
  }, []);

  // 2. success → drop into localStorage and go back
  const handleComplete = (result) => {
    const payload = {
      ok: true,
      ts: Date.now(),
      sessionId,
      source: "aws", // 👈 clean name
      score: result?.confidence ?? null,
    };
    try {
      // old name (your form already reads this)
      localStorage.setItem("kpocha:livenessMetrics", JSON.stringify(payload));
      // new name if you want
      localStorage.setItem("kpocha:faceCheck", JSON.stringify(payload));
    } catch (_) {}
    nav(back);
  };

  // 3. error → show message
  const handleError = (e) => {
    console.error("[AwsLiveness] error:", e);
    setErr("Face verification did not complete. Please try again.");
  };

  // error shell
  if (err) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: "1rem",
          background: "#f3f4f6",
        }}
      >
        <h1 style={{ fontSize: "1.1rem", fontWeight: 600 }}>
          Face verification
        </h1>
        <p style={{ color: "#b91c1c" }}>{err}</p>
        <button
          onClick={() => nav(back)}
          style={{
            background: "#f59e0b",
            color: "#000",
            padding: "0.5rem 1.2rem",
            borderRadius: "0.5rem",
          }}
        >
          Close
        </button>
      </div>
    );
  }

  // loading shell
  if (!ready) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: "0.6rem",
          background: "#f3f4f6",
        }}
      >
        <h1 style={{ fontSize: "1.1rem", fontWeight: 600 }}>
          Face verification
        </h1>
        <p>Opening camera…</p>
      </div>
    );
  }

  // ✅ real camera – this is the AWS demo look (white, standing oval)
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
        padding: "1.5rem 1rem",
      }}
    >
      <div style={{ width: "100%", maxWidth: "560px" }}>
        <FaceLivenessDetector
          sessionId={sessionId}
          region={region}
          disableInstructionScreen
          displayText={DISPLAY_TEXT}
          onAnalysisComplete={handleComplete}
          onError={handleError}
        />
      </div>

      <button
        onClick={() => nav(back)}
        style={{
          background: "#f59e0b",
          color: "#000",
          padding: "0.5rem 1.2rem",
          borderRadius: "9999px",
          fontWeight: 500,
        }}
      >
        Cancel
      </button>
    </div>
  );
}
