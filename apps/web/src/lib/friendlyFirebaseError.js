// apps/web/src/lib/friendlyFirebaseError.js

export function friendlyFirebaseError(err) {
  // Sometimes you get just a string or a non-Firebase Error
  const rawMsg = typeof err === "string" ? err : err?.message || "";
  const code = err?.code || "";

  // Strip prefix like: "Firebase: ..."
  const cleaned = rawMsg.replace(/^Firebase:\s*/i, "").trim();

  // Helper: when code is missing but message contains something recognizable
  const msg = (cleaned || rawMsg || "").toLowerCase();

  switch (code) {
    // ---- Email/password ----
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "Invalid email or password.";
    case "auth/user-not-found":
      return "No account found with that email.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support.";
    case "auth/email-already-in-use":
      return "That email is already registered. Try signing in instead.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";

    // ---- Network / rate ----
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    case "auth/network-request-failed":
      return "Network error. Please check your connection.";

    // ---- Google popup/redirect common failures ----
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in popup. Allow popups or try again.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was closed before finishing. Please try again.";
    case "auth/cancelled-popup-request":
      return "Google sign-in was interrupted. Please try again.";
    case "auth/redirect-cancelled-by-user":
      return "Google sign-in was cancelled. Please try again.";

    // ---- Config / project issues ----
    case "auth/operation-not-allowed":
      return "Google sign-in is not enabled yet. Contact support.";
    case "auth/unauthorized-domain":
      return "This website isn’t authorized for Google sign-in. Contact support.";
    case "auth/invalid-api-key":
      return "App configuration error (invalid API key). Contact support.";
    case "auth/argument-error":
      return "Google sign-in misconfiguration. Contact support.";
    case "auth/app-not-authorized":
      return "This app is not authorized for Google sign-in. Contact support.";
    case "auth/email-not-verified":
      return "Please verify your email to continue.";

    default: {
      // message-based fallbacks (when code is missing)
      if (msg.includes("popup") && msg.includes("blocked"))
        return "Your browser blocked the Google sign-in popup. Allow popups or try again.";
      if (msg.includes("popup") && msg.includes("closed"))
        return "Google sign-in was closed before finishing. Please try again.";
      if (msg.includes("unauthorized-domain"))
        return "This website isn’t authorized for Google sign-in. Contact support.";

      return cleaned || "Something went wrong. Please try again.";
    }
  }
}
