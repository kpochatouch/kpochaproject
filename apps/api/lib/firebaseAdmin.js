// apps/api/lib/firebaseAdmin.js
import admin from "firebase-admin";

let initialized = false;

function tryInit() {
  try {
    if (admin.apps && admin.apps.length > 0) {
      initialized = true;
      console.log("[firebaseAdmin] already initialized; apps.length =", admin.apps.length);
      return;
    }

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log("[firebaseAdmin] using FIREBASE_SERVICE_ACCOUNT env var (len=" + String(process.env.FIREBASE_SERVICE_ACCOUNT?.length) + ")");
      let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
      // handle newline-escaped keys
      if (raw.includes("\\n")) raw = raw.replace(/\\n/g, "\n");
      const sa = JSON.parse(raw);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      initialized = true;
      console.log("[firebaseAdmin] initialized from FIREBASE_SERVICE_ACCOUNT");
      return;
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log("[firebaseAdmin] using GOOGLE_APPLICATION_CREDENTIALS");
      admin.initializeApp();
      initialized = true;
      return;
    }

    console.log("[firebaseAdmin] no service account env found — trying admin.initializeApp()");
    admin.initializeApp();
    initialized = true;
    console.log("[firebaseAdmin] default initializeApp() succeeded");
  } catch (e) {
    console.warn("[firebaseAdmin] initializeApp() failed:", e?.message || e);
    initialized = false;
  }
}

tryInit();

function verifyToken(idToken) {
  if (!initialized) {
    const err = new Error("Firebase admin not initialized");
    err.code = "FIREBASE_NOT_INITIALIZED";
    throw err;
  }
  return admin.auth().verifyIdToken(idToken);
}

export default admin;
export { initialized as firebaseAdminInitialized, verifyToken };
