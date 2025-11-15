// apps/web/src/context/MeContext.jsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { onIdTokenChanged } from "firebase/auth";
import { auth } from "../lib/firebase";
import { api, setAuthToken } from "../lib/api";

const MeContext = createContext(null);

export function MeProvider({ children }) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({
    loading: true,
    me: null,
    error: null,
  });

  // watch firebase token
  useEffect(() => {
    const unsub = onIdTokenChanged(auth, async (user) => {
      try {
        const token = user ? await user.getIdToken() : null;
        setAuthToken(token);

        // <-- NEW: ensure server-side client profile exists
        if (token) {
          try {
            // safe, idempotent — server will create or sync the profile
            await api.post("/api/profile/ensure");
          } catch (err) {
            // non-fatal; we'll still try to load /api/me below
            console.warn("profile ensure failed (onIdTokenChanged):", err?.message || err);
          }
        }
      } finally {
        setVersion((v) => v + 1);
      }
    });
    return () => unsub();
  }, []);

  // initial write (on refresh)
  useEffect(() => {
    (async () => {
      try {
        const u = auth.currentUser;
        const token = u ? await u.getIdToken() : null;
        setAuthToken(token);

        // <-- NEW: also ensure profile on initial page load / refresh
        if (token) {
          try {
            await api.post("/api/profile/ensure");
          } catch (err) {
            console.warn("profile ensure failed (initial):", err?.message || err);
          }
        }
      } catch {
        setAuthToken(null);
      }
    })();
  }, []);

  // actually fetch /api/me
  useEffect(() => {
    let alive = true;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const { data } = await api.get("/api/me");
        if (!alive) return;
        // expose globally if you really want
        if (typeof window !== "undefined") {
          window.__ME__ = data || null;
        }
        setState({ loading: false, me: data || null, error: null });
      } catch (e) {
        if (!alive) return;
        setState({ loading: false, me: null, error: e });
      }
    })();
    return () => {
      alive = false;
    };
  }, [version]);

  const value = useMemo(() => {
    const isPro = !!state?.me?.isPro;
    const isAdmin = !!state?.me?.isAdmin;
    return {
      ...state,
      isPro,
      isAdmin,
      refresh: () => setVersion((v) => v + 1),
    };
  }, [state]);

  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe() {
  const ctx = useContext(MeContext);
  return (
    ctx || {
      loading: true,
      me: null,
      isPro: false,
      isAdmin: false,
      error: null,
      refresh: () => {},
    }
  );
}
