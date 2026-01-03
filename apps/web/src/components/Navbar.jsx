// apps/web/src/components/Navbar.jsx
import { Link, NavLink } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { getAuth, onIdTokenChanged, signOut } from "firebase/auth";
import { api } from "../lib/api";
import NotificationBell from "./NotificationBell.jsx";
import useNotifications from "../hooks/useNotifications"; // added for unread badge

export default function Navbar() {
  const [me, setMe] = useState(null);
  const [token, setToken] = useState(
    () => localStorage.getItem("token") || null
  );
  const [open, setOpen] = useState(false);
  const headerRef = useRef(null); // 👈 keep this

  // new: get unread from the shared notifications hook (lightweight)
  // This keeps the small chat/inbox unread bubble in sync with the bell
  const { unread = 0 } = useNotifications();

  // watch firebase auth → keep token in localStorage
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

  useEffect(() => {
    function onGlobalClick(e) {
      if (!open) return;
      if (!headerRef.current) return;

      const target = e?.detail?.target;
      // If click is inside header (logo, nav, toggle, mobile menu), ignore
      if (target && headerRef.current.contains(target)) return;

      setOpen(false);
    }

    window.addEventListener("global-click", onGlobalClick);
    return () => window.removeEventListener("global-click", onGlobalClick);
  }, [open]);

  // fetch /api/me when we have a token
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
    } catch {}
    try {
      localStorage.removeItem("token");
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
    <header
      ref={headerRef}
      className="border-b border-zinc-800 sticky top-0 z-40 bg-black/70 backdrop-blur h-[60px]"
    >
      <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between gap-3">
        {/* centered on mobile, left on md+ */}
        <Link to="/" className="flex items-center gap-2 mx-auto md:mx-0">
          <img src="/logo.svg" alt="Kpocha Touch" className="h-6 w-auto" />
          <span className="text-gold font-semibold text-sm sm:text-base">
            Kpocha Touch
          </span>
        </Link>

        {/* desktop */}
        <nav className="hidden md:flex items-center gap-4">
          <NavLink to="/browse" className={navLinkClass}>
            Browse
          </NavLink>

          <NavLink to="/for-you" className={navLinkClass}>
            For You
          </NavLink>

          {token && (
            <NavLink to="/my-bookings" className={navLinkClass}>
              My Bookings
            </NavLink>
          )}

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

          {/* Inbox / Chat link (desktop) */}
         {token && (
          <NavLink
            to="/inbox"
            className={({ isActive }) =>
              `relative ${
                isActive ? "text-gold font-medium" : "hover:text-gold"
              }`
            }
          >
            <span>Chat</span>
            {unread > 0 && (
              <span className="absolute -top-2 -right-3 text-[10px] bg-red-600 text-white rounded-full px-1.5 py-0.5 leading-none font-semibold">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
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

          {/* notification bell + signout */}
          {token && <NotificationBell />}

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

        {/* mobile btn */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="md:hidden inline-flex items-center justify-center rounded-lg border border-zinc-700 p-2 text-zinc-200"
        >
          {open ? (
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

      {open && (
        <div className="md:hidden border-t border-zinc-800 bg-black/95 backdrop-blur">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-2">
            {token && (
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-zinc-400">Notifications</span>
                <NotificationBell />
              </div>
            )}

            <NavLink
              to="/browse"
              onClick={() => setOpen(false)}
              className={navLinkClass}
            >
              Browse
            </NavLink>

            <NavLink
              to="/for-you"
              onClick={() => setOpen(false)}
              className={navLinkClass}
            >
              For You
            </NavLink>

            {token && (
              <NavLink
                to="/my-bookings"
                onClick={() => setOpen(false)}
                className={navLinkClass}
              >
                My Bookings
              </NavLink>
            )}

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

            {/* Mobile Inbox entry */}
            {token && (
              <NavLink
                to="/inbox"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between"
              >
                <span className={navLinkClass}>Inbox</span>
                {unread > 0 && (
                  <span className="ml-2 text-[10px] bg-red-600 text-white rounded-full px-1.5 py-0.5 leading-none font-semibold">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </NavLink>
            )}

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
