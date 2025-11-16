// apps/api/lib/firebaseAdmin.js
import admin from "firebase-admin";

if (!admin.apps || admin.apps.length === 0) {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(sa),
    });
  } else {
    try {
      admin.initializeApp();
    } catch (e) {
      console.warn("[firebaseAdmin] initializeApp() failed:", e?.message || e);
    }
  }
}

export default admin;
