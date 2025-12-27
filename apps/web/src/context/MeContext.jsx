// apps/web/src/context/MeContext.jsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../lib/api";

const MeContext = createContext(null);

/**
 * MeProvider
 *
 * Responsibilities (ONLY):
 * - Fetch /api/me using already-authenticated axios
 * - Expose me, loading, error
 * - Derive role flags (isPro, isAdmin)
 *
 * Non-responsibilities:
 * - Firebase auth
 * - Token handling
 * - localStorage
 */
export function MeProvider({ children }) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({
    loading: true,
    me: null,
    error: null,
  });

  // Fetch /api/me whenever version changes
  useEffect(() => {
    let alive = true;

    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const { data } = await api.get("/api/me");
        if (!alive) return;

        // Optional global exposure (kept from your original logic)
        if (typeof window !== "undefined") {
          window.__ME__ = data || null;
        }

        setState({
          loading: false,
          me: data || null,
          error: null,
        });
      } catch (e) {
        if (!alive) return;

        setState({
          loading: false,
          me: null,
          error: e,
        });
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
      // Allow consumers to manually refetch /api/me
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
