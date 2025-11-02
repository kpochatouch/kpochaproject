// apps/web/src/pages/AwsLiveness.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaceLivenessDetector } from "@aws-amplify/ui-react-liveness";
import { api } from "../lib/api";
import { ensureAwsConfigured, getAwsLivenessConfig } from "../lib/awsLivenessClient";

// our own CSS to strip vendor look
import "../styles/aws-liveness.css";

const DISPLAY_TEXT = {
  headingText: "Face verification",
  subheadingText: "Fit your face inside the oval and follow the line.",
  photosensitivityWarningHeadingText: "",
  photosensitivityWarningText: "",
  photosensitivityWarningInfoText: "",
  instructionsHeaderText: "",
  instructionsDescriptionText: "",
  instructionListText: [],
  challengeInProgressText: "Keep steady…",
  challengeCompleteText: "Done",
  challengeFailedErrorText: "Do it exactly as shown.",
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

  // 1. init + ask backend for session
  useEffect(() => {
    (async () => {
      try {
        ensureAwsConfigured();
        const cfg = getAwsLivenessConfig();
        setRegion(cfg.region);

        const { data } = await api.post("/api/aws-liveness/session", {});
        if (!data?.ok || !data.sessionId) {
          throw new Error("Cannot start face verification.");
        }

        setSessionId(data.sessionId);
        setReady(true);
      } catch (e) {
        console.error("[FaceCheck] init failed:", e);
        setErr(e?.message || "Cannot start face verification.");
      }
    })();
  }, []);

  // 2. when done
  const handleComplete = (result) => {
    const payload = {
      ok: true,
      ts: Date.now(),
      sessionId,
      source: "face-check",
      confidence: result?.confidence ?? null,
    };
    try {
      // new name (clean)
      localStorage.setItem("kpocha:faceCheck", JSON.stringify(payload));
      // backward-compatible name (old form still reading this)
      localStorage.setItem("kpocha:livenessMetrics", JSON.stringify(payload));
    } catch (_) {}
    nav(back);
  };

  const handleError = () => {
    setErr("Face verification did not complete. Please try again.");
  };

  // error view
  if (err) {
    return (
      <div className="kt-face-shell">
        <div className="kt-face-card">
          <h1 className="kt-face-title">Face verification</h1>
          <p className="kt-face-error">{err}</p>
          <button onClick={() => nav(back)} className="kt-face-btn">
            Close
          </button>
        </div>
      </div>
    );
  }

  // loading view
  if (!ready) {
    return (
      <div className="kt-face-shell">
        <div className="kt-face-card">
          <h1 className="kt-face-title">Face verification</h1>
          <p className="kt-face-text">Opening camera…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="kt-face-shell">
      {/* short instruction bar */}
      <div className="kt-face-hint">
        For best result: remove cap/headtie, face the light, hold phone steady.
      </div>

      {/* single-layer detector */}
      <div className="kt-face-frame">
        <FaceLivenessDetector
          sessionId={sessionId}
          region={region}
          disableInstructionScreen
          onAnalysisComplete={handleComplete}
          onError={handleError}
          displayText={DISPLAY_TEXT}
        />
      </div>

      {/* fixed close */}
      <button onClick={() => nav(back)} className="kt-face-close">
        Cancel
      </button>
    </div>
  );
}
