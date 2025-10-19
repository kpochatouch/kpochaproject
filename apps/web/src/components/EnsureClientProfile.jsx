import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

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
