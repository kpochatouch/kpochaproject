// apps/web/src/components/Navbar.jsx
import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuth } from "../context/AuthContext.jsx";
import { useMe } from "../context/MeContext.jsx";
import NotificationBell from "./NotificationBell.jsx";
import InstallAppButton from "./InstallAppButton.jsx";
import { getTheme, toggleTheme } from "../lib/theme";

export default function Navbar() {
  const { user, loading: authLoading } = useAuth();
  const { me, loading: meLoading } = useMe();
  // "logged in" should be Firebase truth, not /api/me truth
  const token = user ? "1" : null;
  const authKnown = !authLoading;
  const meKnown = !meLoading;

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

  async function handleSignOut() {
    try {
      await signOut(auth);
    } catch {}

    try {
      sessionStorage.clear();
      sessionStorage.removeItem("g_state");
      localStorage.removeItem("g_state");
    } catch {}

    window.location.assign("/login?signedout=1");
  }

  const isAdmin = meKnown ? !!me?.isAdmin : false;
  const isPro = meKnown ? !!me?.isPro : false;

  const navLinkClass = ({ isActive }) =>
    isActive
      ? "text-gold font-semibold text-[16px]"
      : "hover:text-gold text-[16px] font-medium text-[var(--app-text)]";

  const chipClass = (active) =>
    `px-3 py-2 rounded-full border text-[15px] font-medium whitespace-nowrap ${
      active
        ? "border-gold text-gold"
        : "text-[var(--app-text)] hover:border-zinc-500"
    }`;

  const [theme, setThemeState] = useState(() => getTheme());

  useEffect(() => {
    function onThemeChange(e) {
      setThemeState(e?.detail || getTheme());
    }
    window.addEventListener("kpocha:theme-change", onThemeChange);
    return () =>
      window.removeEventListener("kpocha:theme-change", onThemeChange);
  }, []);

  function handleToggleTheme() {
    const next = toggleTheme();
    setThemeState(next);
  }

  return (
    <header
      className="border-b sticky top-0 z-40 backdrop-blur md:h-[60px]"
      style={{
        borderColor: "var(--app-border)",
        background: "var(--app-navbar)",
        color: "var(--app-text)",
      }}
    >
      <div className="max-w-[1400px] mx-auto px-3 md:px-4 h-full flex items-center justify-between gap-3">
        {/* desktop brand only (mobile uses the custom mobile header below) */}
        <Link to="/browse" className="hidden md:flex items-center gap-2">
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
        <nav className="hidden md:flex items-center gap-5">
          <NavLink to="/browse" className={navLinkClass}>
            Discover
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
                `relative text-[16px] ${
                  isActive
                    ? "text-gold font-semibold"
                    : "hover:text-gold text-[var(--app-text)] font-medium"
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

          <button
            onClick={handleToggleTheme}
            className="rounded-xl border px-4 py-2 text-[15px] font-medium"
            style={{
              borderColor: "var(--app-border)",
              color: "var(--app-text)",
              backgroundColor: "var(--app-surface)",
            }}
            type="button"
          >
            {theme === "light" ? "Dark" : "Bright"}
          </button>

          {/* notification bell + signout */}
          {token && <NotificationBell />}

          {authKnown && token && (
            <button
              onClick={handleSignOut}
              className="rounded-xl border border-gold px-4 py-2 text-[15px] font-medium text-[var(--app-text)] hover:bg-gold hover:text-black"
            >
              Sign Out
            </button>
          )}

          {authKnown && !token && (
            <NavLink
              to="/login"
              className="rounded-xl border border-gold px-4 py-2 text-[15px] font-medium text-[var(--app-text)] hover:bg-gold hover:text-black"
            >
              Sign In
            </NavLink>
          )}
        </nav>
        <div className="md:hidden w-full px-2 py-2 flex flex-col gap-2">
          {/* Row 1: fixed (NOT scrollable) */}
          <div className="flex items-center justify-between gap-2">
            <Link to="/browse" className="flex items-center gap-2">
              <img
                src="/logo-kpocha.png"
                alt="Kpocha Touch"
                className="h-9 w-9 object-contain"
              />
              <span className="text-gold font-semibold text-base leading-none">
                Kpocha Touch
              </span>
            </Link>
            <div className="flex items-center gap-2">
              {/* Install stays visible on mobile */}
              <InstallAppButton />

              <button
                onClick={handleToggleTheme}
                className="rounded-lg border px-3 py-1 text-sm"
                style={{
                  borderColor: "var(--app-border)",
                  color: "var(--app-text)",
                  backgroundColor: "var(--app-surface)",
                }}
                type="button"
              >
                {theme === "light" ? "Dark" : "Bright"}
              </button>

              {token && <NotificationBell />}

              {/* Auth buttons on mobile */}
              {authKnown && token && (
                <button
                  onClick={handleSignOut}
                  className="rounded-lg border border-gold px-3 py-1 text-sm hover:bg-gold hover:text-black"
                >
                  Sign Out
                </button>
              )}

              {authKnown && !token && (
                <NavLink
                  to="/login"
                  className="rounded-lg border border-gold px-3 py-1 text-sm hover:bg-gold hover:text-black"
                >
                  Sign In
                </NavLink>
              )}
            </div>
          </div>
          {/* Row 2: scrollable chips (ALL desktop items) */}
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NavLink to="/browse" className={() => chipClass(isDiscover)}>
              Discover
            </NavLink>

            <NavLink to="/browse?tab=pros" className={() => chipClass(isPros)}>
              Book Professionals
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
