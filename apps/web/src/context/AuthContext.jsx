// apps/web/src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from "react";
import { auth } from "../lib/firebase";
import { onIdTokenChanged, signOut } from "firebase/auth";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onIdTokenChanged(auth, async (u) => {
      setUser(u || null);
      setLoading(false);

      if (u) {
        const token = await u.getIdToken(true);
        localStorage.setItem("token", token);
      } else {
        localStorage.removeItem("token");
      }
    });
  }, []);

  const logout = () => signOut(auth);

  return (
    <AuthCtx.Provider value={{ user, loading, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
