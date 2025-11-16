// apps/api/lib/firebaseAdmin.js
import fs from "fs";
import admin from "firebase-admin";

let initialized = false;

function tryInit() {
  if (initialized) return admin;
  try {
    const keyPath =
      process.env.SERVICE_KEY_PATH ||
      new URL("../serviceAccountKey.json", import.meta.url).pathname;
    if (fs.existsSync(keyPath)) {
      const svc = JSON.parse(fs.readFileSync(keyPath, "utf8"));
      admin.initializeApp({ credential: admin.credential.cert(svc) });
      console.log("[auth] ✅ Firebase Admin initialized (service account).");
    } else {
      // fallback to ADC
      admin.initializeApp();
      console.log("[auth] ✅ Firebase Admin initialized (ADC fallback).");
    }
    initialized = true;
    return admin;
  } catch (err) {
    // bubble error so startup stops and you see the failure
    console.error("[auth] ❌ Firebase Admin failed to initialize:", err?.message || err);
    throw err;
  }
}

tryInit();

export default admin;
