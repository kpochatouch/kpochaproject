// apps/web/src/context/MeContext.jsx

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext.jsx";

const MeContext = createContext(null);

export function MeProvider({ children }) {
  const { user, loading: authLoading } = useAuth();

  const [version, setVersion] = useState(0);
  const [state, setState] = useState({
    loading: true,
    me: null,
    error: null,
  });

  // Fetch /api/me ONLY after auth is ready
  useEffect(() => {
    if (authLoading) return;

    // Not logged in → no /api/me call
    if (!user) {
      setState({ loading: false, me: null, error: null });
      return;
    }

    let alive = true;

    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const { data } = await api.get("/api/me");
        if (!alive) return;

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
  }, [authLoading, user, version]);

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

  return (
    <MeContext.Provider value={value}>
      {children}
    </MeContext.Provider>
  );
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
