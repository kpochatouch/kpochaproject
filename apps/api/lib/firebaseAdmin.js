// apps/api/lib/firebaseAdmin.js
import fs from "fs";
import admin from "firebase-admin";

let initialized = false;

function tryInit() {
  if (initialized) return admin;

  try {
    // Determine key path
    const keyPath =
      process.env.SERVICE_KEY_PATH ||
      new URL("../serviceAccountKey.json", import.meta.url).pathname;

    // If service account exists, use it
    if (fs.existsSync(keyPath)) {
      const svc = JSON.parse(fs.readFileSync(keyPath, "utf8"));
      admin.initializeApp({
        credential: admin.credential.cert(svc),
      });
      console.log("[auth] ✅ Firebase Admin initialized (service account).");
    } else {
      // Otherwise fallback to ADC (Google Cloud runtime)
      admin.initializeApp();
      console.log("[auth] ✅ Firebase Admin initialized (ADC fallback).");
    }

    initialized = true;
    return admin;
  } catch (err) {
    console.error("[auth] ❌ Firebase Admin failed to initialize:", err?.message || err);
    throw err;
  }
}

// Initialize immediately on import
tryInit();

// Export the initialized admin instance
export default admin;
