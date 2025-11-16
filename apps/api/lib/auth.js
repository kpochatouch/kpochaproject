// apps/api/lib/auth.js
import admin from "./firebaseAdmin.js";


const ADMIN_UIDS = (process.env.ADMIN_UIDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// helper to check admin by uid/email
export function isAdminUser(user = {}) {
  const byUid = !!user?.uid && ADMIN_UIDS.includes(user.uid);
  const byEmail =
    !!user?.email && ADMIN_EMAILS.includes(String(user.email).toLowerCase());
  return byUid || byEmail;
}

// requireAuth middleware (throws 401 if no valid token)
export async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email || null };
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// tryAuth: optional auth — decode token if present, else continue as guest
export async function tryAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (token) {
      const decoded = await admin.auth().verifyIdToken(token);
      req.user = { uid: decoded.uid, email: decoded.email || null };
    }
  } catch {}
  next();
}

// requireAdmin middleware (uses isAdminUser). Assumes requireAuth ran earlier
export function requireAdmin(req, res, next) {
  // If no req.user, tryAuth/requireAuth was not used — deny
  if (!req.user) return res.status(403).json({ error: "Admin only" });
  if (!isAdminUser(req.user)) return res.status(403).json({ error: "Admin only" });
  return next();
}
