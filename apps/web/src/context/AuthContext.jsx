// apps/web/src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from "react";
import { auth } from "../lib/firebase";
import { onIdTokenChanged, signOut } from "firebase/auth";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen once; do NOT force token refresh here
    const unsub = onIdTokenChanged(auth, async (u) => {
      setUser(u || null);
      setLoading(false);

      try {
        if (u) {
          const tok = await u.getIdToken(); // no "true" here
          localStorage.setItem("token", tok);
        } else {
          localStorage.removeItem("token");
        }
      } catch {
        // ignore token storage errors
      }
    });
    return () => unsub();
  }, []);

  const logout = () => signOut(auth);

  return (
    <AuthCtx.Provider value={{ user, loading, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
