// apps/web/src/components/Navbar.jsx
import { Link, NavLink } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { getAuth, onIdTokenChanged, signOut } from "firebase/auth";
import { api } from "../lib/api";
import NotificationBell from "./NotificationBell.jsx";
import InstallAppButton from "./InstallAppButton.jsx";
import { menuIcons } from "../constants/menuIcons";

export default function Navbar() {
  const [me, setMe] = useState(null);
  const [token, setToken] = useState(
    () => localStorage.getItem("token") || null
  );
  const [open, setOpen] = useState(false);
  const headerRef = useRef(null); // 👈 keep this

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
            Inbox
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

      <div className="md:hidden flex items-center gap-2 w-full px-2">
  {/* Primary mobile actions (ALWAYS visible) */}

  <NavLink
    to="/browse"
    className="p-2 rounded-lg hover:bg-zinc-800"
    aria-label="Feed"
  >
    <img src={menuIcons.feed} className="w-5 h-5" alt="" />
  </NavLink>

  <NavLink
    to="/for-you"
    className="p-2 rounded-lg hover:bg-zinc-800"
    aria-label="For You"
  >
    <img src={menuIcons.foryou} className="w-5 h-5" alt="" />
  </NavLink>

  {token && (
    <NavLink
      to="/inbox"
      className="p-2 rounded-lg hover:bg-zinc-800"
      aria-label="Chat"
    >
      <img src={menuIcons.chat} className="w-5 h-5" alt="" />
    </NavLink>
  )}

  {/* Push install + menu to the right */}
  <div className="flex-1" />

  {/* Install App — stays visible */}
  <InstallAppButton />

  {/* Overflow menu (three dots) */}
  <button
    onClick={() => setOpen((o) => !o)}
    className="inline-flex items-center justify-center rounded-lg border border-zinc-700 p-2 text-zinc-200"
    aria-label="More"
  >
    {open ? (
      <svg className="h-5 w-5" viewBox="0 0 24 24" stroke="currentColor" fill="none">
        <path d="M6 18L18 6" />
        <path d="M6 6l12 12" />
      </svg>
    ) : (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="5" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="12" cy="19" r="1.8" />
      </svg>
    )}
  </button>
</div>

      {open && (
        <div className="md:hidden border-t border-zinc-800 bg-black/95 backdrop-blur">
          <div className="w-full px-4 py-3 flex flex-col gap-2">
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
                  className={navLinkClass}
                >
                  Inbox
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
