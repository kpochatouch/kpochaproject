// apps/web/src/pages/EnsureClientProfile.jsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Guard for pages that require login.
 * IMPORTANT:
 * - We DO NOT force people to have a client profile here, because some users are pro-only.
 * - We ONLY redirect when there is no authenticated user.
 * - Actual profile enforcement should happen inside the specific page (e.g. Settings).
 */
export default function EnsureClientProfile({ children }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate("/login");
  }, [user, loading, navigate]);

  if (loading) return <div className="p-6">Loading…</div>;
  return <>{children}</>;
}

/**
 * NOTES (EnsureClientProfile.jsx)
 * 1. We left it very light so it won’t “fight” the rule that some users are pro-only.
 * 2. If later you want: “if user has no /api/profile/me → send to /client-settings”, do it INSIDE that page.
 * 3. This file’s only job now: block guests.
 */
