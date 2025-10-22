import { Link, NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAuth, onIdTokenChanged, signOut } from "firebase/auth";
import { api } from "../lib/api";

export default function Navbar() {
  const [me, setMe] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("token") || null);
  const [open, setOpen] = useState(false);

  // keep token in sync
  useEffect(() => {
    const auth = getAuth();
    const unsub = onIdTokenChanged(auth, async (user) => {
      if (user) {
        const t = await user.getIdToken();
        localStorage.setItem("token", t);
        setToken(t);
      } else {
        localStorage.removeItem("token");
        setToken(null);
      }
    });
    return () => unsub();
  }, []);

  // load /api/me on token change
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

  const linkClass = ({ isActive }) =>
    isActive ? "text-gold font-medium" : "hover:text-gold";

  return (
    // 👇 add a stable id so Home.jsx can measure this height
    <header id="app-header" className="sticky top-0 z-40 border-b border-zinc-800 bg-black/70 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex h-14 items-center justify-between">
          {/* Logo / home */}
          <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
            <img src="/logo.svg" alt="Kpocha Touch" className="h-8 w-auto" />
            <span className="hidden md:inline text-gold font-semibold">
              Connecting You To Top Barbers and Stylists
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-4">
            <NavLink to="/browse" className={linkClass}>Browse</NavLink>
            {token && <NavLink to="/wallet" className={linkClass}>Wallet</NavLink>}
            <NavLink to="/profile" className={linkClass}>Profile</NavLink>
            {token && <NavLink to="/settings" className={linkClass}>Settings</NavLink>}
            {!isPro && token && <NavLink to="/become" className={linkClass}>Become a Pro</NavLink>}
            {isPro && token && <NavLink to="/pro-dashboard" className={linkClass}>Pro Dashboard</NavLink>}
            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  isActive ? "text-gold font-medium border-b-2 border-gold" : "hover:text-gold"
                }
              >
                Admin
              </NavLink>
            )}
            {token ? (
              <button
                onClick={handleSignOut}
                className="rounded-lg border border-gold px-3 py-1 hover:bg-gold hover:text-black"
              >
                Sign Out
              </button>
            ) : (
              <NavLink
                to="/login"
                className="rounded-lg border border-gold px-3 py-1 hover:bg-gold hover:text-black"
              >
                Sign In
              </NavLink>
            )}
          </nav>

          {/* Mobile hamburger */}
          <button
            aria-label="Open menu"
            className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 hover:bg-zinc-900"
            onClick={() => setOpen((v) => !v)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              {open ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden border-t border-zinc-800 bg-black">
          <nav className="mx-auto max-w-6xl px-4 py-3 flex flex-col gap-2">
            <NavLink to="/browse" className={linkClass} onClick={() => setOpen(false)}>Browse</NavLink>
            {token && <NavLink to="/wallet" className={linkClass} onClick={() => setOpen(false)}>Wallet</NavLink>}
            <NavLink to="/profile" className={linkClass} onClick={() => setOpen(false)}>Profile</NavLink>
            {token && <NavLink to="/settings" className={linkClass} onClick={() => setOpen(false)}>Settings</NavLink>}
            {!isPro && token && (
              <NavLink to="/become" className={linkClass} onClick={() => setOpen(false)}>Become a Pro</NavLink>
            )}
            {isPro && token && (
              <NavLink to="/pro-dashboard" className={linkClass} onClick={() => setOpen(false)}>Pro Dashboard</NavLink>
            )}
            {isAdmin && (
              <NavLink to="/admin" className={linkClass} onClick={() => setOpen(false)}>Admin</NavLink>
            )}
            {token ? (
              <button
                onClick={handleSignOut}
                className="mt-1 rounded-lg border border-gold px-3 py-2 hover:bg-gold hover:text-black text-left"
              >
                Sign Out
              </button>
            ) : (
              <NavLink
                to="/login"
                className="mt-1 rounded-lg border border-gold px-3 py-2 hover:bg-gold hover:text-black"
                onClick={() => setOpen(false)}
              >
                Sign In
              </NavLink>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
