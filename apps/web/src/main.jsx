// apps/web/src/main.jsx
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/global.css";
import { AuthProvider } from "./context/AuthContext.jsx";
import { MeProvider } from "./context/MeContext.jsx"; // ✅ add this


// 🟡 AWS (added earlier)
import { Amplify } from "aws-amplify";
import awsconfig from "./aws-exports.js";

// ✅ configure AWS safely
if (typeof window !== "undefined") {
  if (!window.__KPOCHA_AWS_CONFIGURED__) {
    try {
      if (
        awsconfig &&
        (awsconfig.aws_cognito_identity_pool_id || awsconfig.aws_project_region)
      ) {
        Amplify.configure(awsconfig);
      }
    } catch (e) {
      console.warn("[kpocha] AWS Amplify config skipped:", e?.message);
    }
    window.__KPOCHA_AWS_CONFIGURED__ = true;
  }
}

// ✅ Correct Provider order: AuthProvider → MeProvider → App
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <AuthProvider>
      <MeProvider>
        <App />
      </MeProvider>
    </AuthProvider>
  </BrowserRouter>
);
