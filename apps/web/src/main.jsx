// apps/web/src/main.jsx
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/global.css";
import { AuthProvider } from "./context/AuthContext.jsx";

// 🔐 Firebase token sync (your existing code)
import { getAuth, onIdTokenChanged } from "firebase/auth";

// 🟡 AWS (added)
// We configure AWS Amplify with the values you put in
// VITE_AWS_REGION and VITE_AWS_COGNITO_IDENTITY_POOL_ID
import { Amplify } from "aws-amplify";
import awsconfig from "./aws-exports.js";

// configure AWS first
Amplify.configure(awsconfig);

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
