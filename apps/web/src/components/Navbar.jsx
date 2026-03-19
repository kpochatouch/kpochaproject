// apps/web/src/components/Navbar.jsx
import { Link, NavLink, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuth } from "../context/AuthContext.jsx";
import { useMe } from "../context/MeContext.jsx";
import NotificationBell from "./NotificationBell.jsx";
import InstallAppButton from "./InstallAppButton.jsx";

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
      ? "text-gold font-medium text-[15px]"
      : "hover:text-gold text-[15px] text-zinc-100";

  const chipClass = (active) =>
    `px-3 py-2 rounded-full border text-base whitespace-nowrap ${
      active
        ? "border-gold text-gold bg-zinc-900/40"
        : "border-zinc-700 text-zinc-200 hover:border-zinc-500"
    }`;

  return (
    <header className="border-b border-zinc-800 sticky top-0 z-40 bg-[#0f1115]/90 backdrop-blur md:h-[60px]">
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
                `relative text-[15px] ${
                  isActive
                    ? "text-gold font-medium"
                    : "hover:text-gold text-zinc-100"
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

          {authKnown && token && (
            <button
              onClick={handleSignOut}
              className="rounded-lg border border-gold px-3 py-1.5 text-sm text-zinc-100 hover:bg-gold hover:text-black"
            >
              Sign Out
            </button>
          )}

          {authKnown && !token && (
            <NavLink
              to="/login"
              className="rounded-lg border border-gold px-3 py-1.5 text-sm text-zinc-100 hover:bg-gold hover:text-black"
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
