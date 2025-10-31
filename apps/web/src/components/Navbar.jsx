// apps/web/src/components/Navbar.jsx
import { Link, NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAuth, onIdTokenChanged, signOut } from "firebase/auth";
import { api } from "../lib/api";

export default function Navbar() {
  const [me, setMe] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("token") || null);
  const [open, setOpen] = useState(false); // ✅ mobile menu

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
    return () => {
      alive = false;
    };
  }, [token]);

  async function handleSignOut() {
    try {
      const auth = getAuth();
      await signOut(auth);
    } catch (e) {
      console.error("Firebase sign-out error:", e);
    }
    try {
      localStorage.removeItem("token");
    } catch {}
    try {
      sessionStorage.clear();
      sessionStorage.removeItem("g_state");
      localStorage.removeItem("g_state");
    } catch {}
    window.location.assign("/login?signedout=1");
  }

  const isAdmin = !!me?.isAdmin;
  const isPro = !!me?.isPro;

  const navLinkClass = ({ isActive }) =>
    isActive ? "text-gold font-medium" : "hover:text-gold";

  return (
    <header className="border-b border-zinc-800 sticky top-0 z-40 bg-black/70 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="Kpocha Touch" className="h-6 w-auto" />
          {/* ✅ show on mobile too (short) */}
          <span className="text-gold font-semibold text-sm sm:text-base">
            Kpocha Touch
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-4">
          <NavLink to="/browse" className={navLinkClass}>
            Browse
          </NavLink>

          {token && (
            <NavLink to="/wallet" className={navLinkClass}>
              Wallet
            </NavLink>
          )}

          <NavLink to="/profile" className={navLinkClass}>
            Profile
          </NavLink>

          {token && (
            <NavLink to="/settings" className={navLinkClass}>
              Settings
            </NavLink>
          )}

          {!isPro && token && (
            <NavLink to="/become" className={navLinkClass}>
              Become a Pro
            </NavLink>
          )}
          {isPro && token && (
            <NavLink to="/pro-dashboard" className={navLinkClass}>
              Pro Dashboard
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" className={navLinkClass}>
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
          onClick={() => setOpen((o) => !o)}
          className="md:hidden inline-flex items-center justify-center rounded-lg border border-zinc-700 p-2 text-zinc-200"
          aria-label="Toggle menu"
        >
          {open ? (
            // X icon
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 18L18 6" />
              <path d="M6 6l12 12" />
            </svg>
          ) : (
            // Hamburger
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6h16" />
              <path d="M4 12h16" />
              <path d="M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu panel */}
      {open && (
        <div className="md:hidden border-t border-zinc-800 bg-black/95 backdrop-blur">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-2">
            <NavLink
              to="/browse"
              onClick={() => setOpen(false)}
              className={navLinkClass}
            >
              Browse
            </NavLink>
            {token && (
              <NavLink
                to="/wallet"
                onClick={() => setOpen(false)}
                className={navLinkClass}
              >
                Wallet
              </NavLink>
            )}
            <NavLink
              to="/profile"
              onClick={() => setOpen(false)}
              className={navLinkClass}
            >
              Profile
            </NavLink>
            {token && (
              <NavLink
                to="/settings"
                onClick={() => setOpen(false)}
                className={navLinkClass}
              >
                Settings
              </NavLink>
            )}
            {!isPro && token && (
              <NavLink
                to="/become"
                onClick={() => setOpen(false)}
                className={navLinkClass}
              >
                Become a Pro
              </NavLink>
            )}
            {isPro && token && (
              <NavLink
                to="/pro-dashboard"
                onClick={() => setOpen(false)}
                className={navLinkClass}
              >
                Pro Dashboard
              </NavLink>
            )}
            {isAdmin && (
              <NavLink
                to="/admin"
                onClick={() => setOpen(false)}
                className={navLinkClass}
              >
                Admin
              </NavLink>
            )}

            {token ? (
              <button
                onClick={handleSignOut}
                className="mt-2 rounded-lg border border-gold px-3 py-1 hover:bg-gold hover:text-black text-left"
              >
                Sign Out
              </button>
            ) : (
              <NavLink
                to="/login"
                onClick={() => setOpen(false)}
                className="mt-2 rounded-lg border border-gold px-3 py-1 hover:bg-gold hover:text-black text-left"
              >
                Sign In
              </NavLink>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
