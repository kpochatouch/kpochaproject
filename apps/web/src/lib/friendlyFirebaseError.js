// apps/web/src/lib/friendlyFirebaseError.js

export function friendlyFirebaseError(err) {
  // sometimes you get just a string
  const rawMsg = typeof err === "string" ? err : err?.message || "";
  const code = err?.code || "";

  // strip the "Firebase: " prefix if it's there
  const cleaned = rawMsg.replace(/^Firebase:\s*/i, "").trim();

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
      return "Invalid email or password.";
    case "auth/user-not-found":
      return "No account found with that email.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support.";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    case "auth/network-request-failed":
      return "Network error. Please check your connection.";
    default:
      // fall back to whatever Firebase said, just without the prefix
      return cleaned || "Something went wrong. Please try again.";
  }
}