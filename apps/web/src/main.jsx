// apps/web/src/main.jsx
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/global.css";
import { AuthProvider } from "./context/AuthContext.jsx";
import { MeProvider } from "./context/MeContext.jsx"; // ✅ add this

// 🔐 Firebase token sync
import { getAuth, onIdTokenChanged } from "firebase/auth";

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

// ✅ Keep Firebase ID token in sync with localStorage
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
      localStorage.removeItem("token");
    }
  });
}
installAuthTokenSync();

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

// ✅ PWA: register Service Worker (prod only)
// if (import.meta.env.PROD && "serviceWorker" in navigator) {
//   window.addEventListener("load", () => {
//     navigator.serviceWorker.register("/sw.js").catch(console.error);
//   });
// }

// 🧹 Force remove any existing Service Workers
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()));
}