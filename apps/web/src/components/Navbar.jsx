// apps/web/src/components/Navbar.jsx
import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAuth, onIdTokenChanged, signOut } from "firebase/auth";
import { api } from "../lib/api";
import NotificationBell from "./NotificationBell.jsx";
import InstallAppButton from "./InstallAppButton.jsx";

export default function Navbar() {
  const [me, setMe] = useState(null);
  const [token, setToken] = useState(
    () => localStorage.getItem("token") || null,
  );

  const location = useLocation();
  const pathname = location.pathname;
  const search = location.search || "";

  const isDiscover = pathname === "/browse" && !search.includes("tab=pros");
  const isPros = pathname === "/browse" && search.includes("tab=pros");
  const isForYou = pathname.startsWith("/for-you");
  const isBookings = pathname === "/my-bookings";
  const isWallet = pathname === "/wallet";
  const isProfile = pathname === "/profile";
  const isSettings = pathname === "/settings";
  const isInbox = pathname.startsWith("/inbox") || pathname.startsWith("/chat");
  const isProDash = pathname === "/pro-dashboard";
  const isAdminPanel = pathname === "/admin";

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

  const chipClass = (active) =>
    `px-3 py-2 rounded-full border text-sm whitespace-nowrap ${
      active
        ? "border-gold text-gold bg-zinc-900/40"
        : "border-zinc-700 text-zinc-200 hover:border-zinc-500"
    }`;

  return (
    <header className="border-b border-zinc-800 sticky top-0 z-40 bg-black/70 backdrop-blur md:h-[60px]">
      <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between gap-3">
        {/* centered on mobile, left on md+ */}
        <Link to="/" className="flex items-center gap-2 mx-auto md:mx-0">
          <img
            src="/logo-kpocha.png"
            alt="Kpocha Touch"
            className="h-8 w-8 object-contain"
          />
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

        <div className="md:hidden w-full px-2 py-2 flex flex-col gap-2">
          {/* Row 1: fixed (NOT scrollable) */}
          <div className="flex items-center justify-between gap-2">
            <Link to="/" className="flex items-center gap-2">
              <img
                src="/logo-kpocha.png"
                alt="Kpocha Touch"
                className="h-10 w-10 object-contain"
              />
              <span className="text-gold font-semibold text-base leading-none">
                Kpocha Touch
              </span>
            </Link>

            <div className="flex items-center gap-2">
              <InstallAppButton />
              {token && <NotificationBell />}
            </div>
          </div>

          {/* Row 2: scrollable chips (ALL desktop items) */}
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NavLink to="/browse" className={() => chipClass(isDiscover)}>
              Discover
            </NavLink>

            <NavLink to="/browse?tab=pros" className={() => chipClass(isPros)}>
              Browse Pros
            </NavLink>

            {token ? (
              <NavLink to="/for-you" className={() => chipClass(isForYou)}>
                For You
              </NavLink>
            ) : (
              <NavLink to="/login" className={() => chipClass(false)}>
                For You
              </NavLink>
            )}

            {token ? (
              <NavLink
                to="/my-bookings"
                className={() => chipClass(isBookings)}
              >
                My Bookings
              </NavLink>
            ) : null}

            {token ? (
              <NavLink to="/wallet" className={() => chipClass(isWallet)}>
                Wallet
              </NavLink>
            ) : null}

            <NavLink to="/profile" className={() => chipClass(isProfile)}>
              Profile
            </NavLink>

            {token ? (
              <NavLink to="/settings" className={() => chipClass(isSettings)}>
                Settings
              </NavLink>
            ) : null}

            {token ? (
              <NavLink to="/inbox" className={() => chipClass(isInbox)}>
                Inbox
              </NavLink>
            ) : null}

            {!isPro && token ? (
              <NavLink to="/become" className={() => chipClass(false)}>
                Become a Pro
              </NavLink>
            ) : null}

            {isPro && token ? (
              <NavLink
                to="/pro-dashboard"
                className={() => chipClass(isProDash)}
              >
                Pro Dashboard
              </NavLink>
            ) : null}

            {isAdmin ? (
              <NavLink to="/admin" className={() => chipClass(isAdminPanel)}>
                Admin
              </NavLink>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
