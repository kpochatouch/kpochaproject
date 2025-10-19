// apps/web/src/components/RequireLoginAction.jsx
import { useNavigate } from "react-router-dom";

export default function useRequireLoginAction() {
  const navigate = useNavigate();

  function requireLogin(callback) {
    const token = localStorage.getItem("token");

    if (!token) {
      // 👇 Fancy friendly message
      alert("Please sign in or create an account to continue.");
      navigate("/login");
      return false;
    }

    // ✅ If logged in, run the action
    if (typeof callback === "function") callback();
    return true;
  }

  return requireLogin;
}
