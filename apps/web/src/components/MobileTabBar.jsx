// apps/web/src/components/MobileTabBar.jsx
import { NavLink, useLocation } from "react-router-dom";
import {
  IconDiscover,
  IconPros,
  IconForYou,
  IconInbox,
  IconWallet,
  IconHelp,
} from "./KpochaIcons.jsx";

function Tab({ to, label, Icon, isActive }) {
  return (
    <NavLink
      to={to}
      className={() =>
        `flex flex-col items-center justify-center gap-1 px-2 py-2 min-w-[68px] ${
          isActive ? "text-gold" : "text-zinc-300"
        }`
      }
      aria-label={label}
    >
      <Icon className="w-7 h-7" />
      <span className="text-[11px] leading-none">{label}</span>
    </NavLink>
  );
}

export default function MobileTabBar({ me }) {
  const location = useLocation();
  const pathname = location.pathname;
  const search = location.search || "";

  const isDiscover = pathname === "/browse" && !search.includes("tab=pros");
  const isPros = pathname === "/browse" && search.includes("tab=pros");
  const isForYou = pathname.startsWith("/for-you");
  const isInbox = pathname.startsWith("/inbox") || pathname.startsWith("/chat");
  const isWallet = pathname === "/wallet";

  const authed = !!me;
  function openHelp() {
    window.dispatchEvent(new Event("kpocha:open-chatbase"));
  }

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-800 bg-black/92 backdrop-blur">
      <div className="px-2 h-[70px] flex items-center justify-between">
        <Tab
          to="/browse"
          label="Discover"
          Icon={IconDiscover}
          isActive={isDiscover}
        />
        <Tab
          to="/browse?tab=pros"
          label="Pros"
          Icon={IconPros}
          isActive={isPros}
        />

        {/* For You requires auth in your routes */}
        {authed ? (
          <Tab
            to="/for-you"
            label="For You"
            Icon={IconForYou}
            isActive={isForYou}
          />
        ) : (
          <Tab to="/login" label="For You" Icon={IconForYou} isActive={false} />
        )}

        {authed ? (
          <Tab to="/inbox" label="Inbox" Icon={IconInbox} isActive={isInbox} />
        ) : (
          <Tab to="/login" label="Inbox" Icon={IconInbox} isActive={false} />
        )}

        {authed ? (
          <Tab
            to="/wallet"
            label="Wallet"
            Icon={IconWallet}
            isActive={isWallet}
          />
        ) : (
          <Tab to="/login" label="Wallet" Icon={IconWallet} isActive={false} />
        )}

        <button
          type="button"
          onClick={openHelp}
          className="flex flex-col items-center justify-center gap-1 px-2 py-2 min-w-[68px] text-zinc-300"
          aria-label="Help"
        >
          <IconHelp className="w-7 h-7" />
          <span className="text-[11px] leading-none">Help</span>
        </button>
      </div>
    </nav>
  );
}
