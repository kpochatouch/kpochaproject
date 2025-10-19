// apps/web/src/components/Navbar.jsx
import { Link, NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAuth, onIdTokenChanged, signOut } from "firebase/auth";
import { api } from "../lib/api";

export default function Navbar() {
  const [me, setMe] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("token") || null);

  // Keep token state in sync with Firebase (no forced refresh)
  useEffect(() => {
    const auth = getAuth();
    const unsub = onIdTokenChanged(auth, async (user) => {
      if (user) {
        const t = await user.getIdToken(); // don't force refresh
        localStorage.setItem("token", t);
        setToken(t);
      } else {
        localStorage.removeItem("token");
        setToken(null);
      }
    });
    return () => unsub();
  }, []);

  // Load /api/me when token changes
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!token) return alive && setMe(null);
        const { data } = await api.get("/api/me");
        if (alive) setMe(data);
      } catch {
        if (alive) setMe(null);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  async function handleSignOut() {
    try {
      const auth = getAuth();
      await signOut(auth);
    } catch (e) {
      console.error("Firebase sign-out error:", e);
    }
    try { localStorage.removeItem("token"); } catch {}
    try { sessionStorage.clear(); } catch {}
    try { sessionStorage.removeItem("g_state"); } catch {}
    try { localStorage.removeItem("g_state"); } catch {}
    window.location.assign("/login?signedout=1");
  }

  const isAdmin = !!me?.isAdmin;
  const isPro   = !!me?.isPro;

  return (
    <header className="border-b border-zinc-800 sticky top-0 z-40 bg-black/70 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="Kpocha Touch" className="h-6 w-auto" />
          <span className="text-gold font-semibold hidden sm:inline">
            Connecting You To Top Barbers and Stylists
          </span>
        </Link>

        <nav className="flex items-center gap-4">
          <NavLink to="/browse" className={({isActive})=> isActive ? "text-gold font-medium" : "hover:text-gold"}>Browse</NavLink>

          {/* Show Wallet only when signed in.
             It will route to pro wallet or client credits (smart route in App). */}
          {token && (
            <NavLink to="/wallet" className={({isActive})=> isActive ? "text-gold font-medium" : "hover:text-gold"}>
              Wallet
            </NavLink>
          )}

          <NavLink to="/profile" className={({isActive})=> isActive ? "text-gold font-medium" : "hover:text-gold"}>Profile</NavLink>

          {/* ✅ Settings: show only when signed in (smart route picks client/pro) */}
          {token && (
            <NavLink to="/settings" className={({isActive})=> isActive ? "text-gold font-medium" : "hover:text-gold"}>Settings</NavLink>
          )}

          {!isPro && token && (
            <NavLink to="/become" className={({isActive})=> isActive ? "text-gold font-medium" : "hover:text-gold"}>Become a Pro</NavLink>
          )}
          {isPro && token && (
            <NavLink to="/pro-dashboard" className={({isActive})=> isActive ? "text-gold font-medium" : "hover:text-gold"}>Pro Dashboard</NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" className={({isActive})=> isActive ? "text-gold font-medium border-b-2 border-gold" : "hover:text-gold"}>Admin</NavLink>
          )}

          {token ? (
            <button onClick={handleSignOut} className="rounded-lg border border-gold px-3 py-1 hover:bg-gold hover:text-black">Sign Out</button>
          ) : (
            <NavLink to="/login" className="rounded-lg border border-gold px-3 py-1 hover:bg-gold hover:text-black">Sign In</NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}
