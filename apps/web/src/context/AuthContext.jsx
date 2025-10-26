// apps/web/src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from "react";
import { auth } from "../lib/firebase";
import { onIdTokenChanged, signOut } from "firebase/auth";
import { setAuthToken } from "../lib/api"; // ✅ Syncs Firebase token to axios + localStorage

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen for Firebase token changes and update API headers automatically
    const unsub = onIdTokenChanged(auth, async (u) => {
      try {
        setUser(u || null);
        setLoading(false);

        if (u) {
          const token = await u.getIdToken();
          setAuthToken(token); // ✅ replaces localStorage.setItem
        } else {
          setAuthToken(null); // ✅ clears headers + storage
        }
      } catch {
        setAuthToken(null);
      }
    });

    return () => unsub();
  }, []);

  const logout = async () => {
    await signOut(auth);
    setAuthToken(null);
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
