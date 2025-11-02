// apps/web/src/main.jsx
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/global.css";
import { AuthProvider } from "./context/AuthContext.jsx";

// 🔐 Firebase token sync (your existing code)
import { getAuth, onIdTokenChanged } from "firebase/auth";

// 🟡 AWS (added earlier)
import { Amplify } from "aws-amplify";
import awsconfig from "./aws-exports.js";

// ✅ configure AWS safely (so missing envs won't break the app)
if (typeof window !== "undefined") {
  // avoid double-config on HMR
  if (!window.__KPOCHA_AWS_CONFIGURED__) {
    try {
      // only configure if we actually have an identity pool or region
      if (
        awsconfig &&
        (awsconfig.aws_cognito_identity_pool_id || awsconfig.aws_project_region)
      ) {
        Amplify.configure(awsconfig);
      }
    } catch (e) {
      // don't crash UI if AWS is not ready — liveness page will handle it
      console.warn("[kpocha] AWS Amplify config skipped:", e?.message);
    }
    window.__KPOCHA_AWS_CONFIGURED__ = true;
  }
}

// ✅ Keep Firebase ID token in sync with localStorage for API calls
// (Prevents sign-out → instant sign-in loops and stale tokens)
function installAuthTokenSync() {
  const auth = getAuth();
  onIdTokenChanged(auth, async (user) => {
    try {
      if (user) {
        const t = await user.getIdToken(/* forceRefresh */ true);
        localStorage.setItem("token", t);
      } else {
        localStorage.removeItem("token");
      }
    } catch {
      // best effort — don't crash the app
      localStorage.removeItem("token");
    }
  });
}

// Install listener once before rendering the app
installAuthTokenSync();

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
);
