// apps/web/src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from "react";
import { auth } from "../lib/firebase";
import { onIdTokenChanged, signOut } from "firebase/auth";
import { setAuthToken } from "../lib/api"; // ✅ Keeps Firebase token synced to axios + localStorage

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // ✅ Listen for Firebase token changes and update axios headers automatically
    const unsub = onIdTokenChanged(auth, async (u) => {
      try {
        setUser(u || null);
        setLoading(false);

        if (u) {
          const token = await u.getIdToken();
          setAuthToken(token); // ✅ Store & sync to axios
        } else {
          setAuthToken(null); // ✅ Clear on logout or expired session
        }
      } catch {
        setAuthToken(null);
      }
    });

    // ✅ Optional: refresh ID token every 50 minutes to keep session valid
    const refreshLoop = setInterval(
      async () => {
        const currentUser = auth.currentUser;
        if (currentUser) {
          try {
            const freshToken = await currentUser.getIdToken(true);
            setAuthToken(freshToken);
          } catch {
            // silently fail (network loss etc.)
          }
        }
      },
      50 * 60 * 1000,
    ); // 50 minutes

    return () => {
      unsub();
      clearInterval(refreshLoop);
    };
  }, []);

  const logout = async () => {
    try {
      await signOut(auth);
    } catch {
      // ignore any signout error
    }
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
