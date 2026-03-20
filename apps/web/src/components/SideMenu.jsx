// apps/web/src/components/SideMenu.jsx
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import useNotifications from "../hooks/useNotifications"; // <- unread badge
import {
  IconDiscover,
  IconPros,
  IconForYou,
  IconInbox,
  IconBookings,
  IconWallet,
  IconProfile,
  IconSettings,
  IconProDashboard,
  IconAdmin,
  IconHelp,
} from "./KpochaIcons.jsx";

export default function SideMenu({ me }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { unread = 0 } = useNotifications(); // use unread from hook

  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const isAdmin = !!me?.isAdmin;
  const isPro = !!me?.isPro;

  const pathname = location.pathname;
  const search = location.search || "";

  const isFeed = pathname === "/browse" && !search.includes("tab=pros");
  const isBrowsePros = pathname === "/browse" && search.includes("tab=pros");
  const isForYou = pathname.startsWith("/for-you");

  const icons = {
    feed: IconDiscover,
    browse: IconPros,
    profile: IconProfile,
    bookings: IconBookings,
    wallet: IconWallet,
    settings: IconSettings,
    chat: IconInbox,
    foryou: IconForYou,
    pro: IconProDashboard,
    admin: IconAdmin,
    risk: IconAdmin, // no IconRisk yet — using Admin shield for now
    help: IconHelp,
  };

  const baseNav = [
    {
      key: "feed",
      label: "Feed",
      to: "/browse",
      active: isFeed,
    },
    {
      key: "browse",
      label: "Browse Pros",
      to: "/browse?tab=pros",
      active: isBrowsePros,
    },

    me && {
      key: "profile",
      label: "Profile",
      to: "/profile",
      active: pathname === "/profile",
    },

    // My Bookings (client bookings)
    me && {
      key: "bookings",
      label: "My Bookings",
      to: "/my-bookings",
      active: pathname === "/my-bookings",
    },

    me && {
      key: "wallet",
      label: "Wallet",
      to: "/wallet",
      active: pathname === "/wallet",
    },
    me && {
      key: "settings",
      label: "Settings",
      to: "/settings",
      active: pathname === "/settings",
    },

    // Only show Become a Pro when user is not already a pro
    me &&
      !isPro && {
        key: "pro",
        label: "Become a Pro",
        to: "/become",
        active: pathname === "/become",
      },
  ].filter(Boolean);

  const socialNav = [
    {
      key: "chat",
      label: "Chat",
      // route changed to inbox (full inbox view). Keep active for /chat legacy too.
      to: "/inbox",
      active: pathname.startsWith("/inbox") || pathname.startsWith("/chat"),
      disabled: false,
      badge: unread || 0,
    },
    {
      key: "foryou",
      label: "For You",
      to: "/for-you",
      active: isForYou,
      disabled: false,
    },
  ];

  const proNav = isPro
    ? [
        {
          key: "pro",
          label: "Pro Dashboard",
          to: "/pro-dashboard",
          active: pathname === "/pro-dashboard",
        },
      ]
    : [];

  const adminNav = isAdmin
    ? [
        {
          key: "admin",
          label: "Admin Panel",
          to: "/admin",
          active: pathname === "/admin",
        },
        {
          key: "risk",
          label: "Risk / Logs",
          to: "/risk-logs",
          active: pathname === "/risk-logs",
        },
      ]
    : [];

  function go(path) {
    navigate(path);
    setOpen(false);
  }

  return (
    <>
      {/* mobile toggle */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lg:hidden mb-3 rounded-lg border border-zinc-700 px-3 py-1 text-sm bg-black/50"
      >
        {open ? "Close menu" : "Menu"}
      </button>

      <div className="relative">
        {open && (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            style={{ backgroundColor: "var(--app-bg)" }}
            onClick={() => setOpen(false)}
          />
        )}

        <div
          className={`${
            open ? "translate-x-0" : "-translate-x-full"
          } lg:translate-x-0 lg:!transform-none transition-transform duration-200
     fixed lg:sticky inset-0 lg:inset-auto lg:top-20 lg:left-0 z-50 lg:z-40
     h-screen lg:h-auto
     w-screen lg:w-auto
     flex`}
        >
          <div
            className={`${
              collapsed ? "w-14 lg:w-14" : "w-full lg:w-56"
            } border-r h-full lg:h-auto
  rounded-none lg:rounded-xl lg:border
  p-4 space-y-2 overflow-y-auto`}
            style={{
              backgroundColor: "var(--app-bg)",
              borderColor: "var(--app-border)",
              color: "var(--app-text)",
            }}
          >
            {open && (
              <div className="lg:hidden flex items-center justify-between mb-3">
                <div className="text-base font-semibold">Menu</div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border px-3 py-2 text-sm"
                  style={{
                    borderColor: "var(--app-border)",
                    backgroundColor: "var(--app-surface)",
                    color: "var(--app-text)",
                  }}
                >
                  Close
                </button>
              </div>
            )}
            {/* collapse toggle */}
            <div className="hidden lg:flex justify-end mb-1">
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-900"
                title={collapsed ? "Expand" : "Collapse"}
              >
                {collapsed ? "»" : "«"}
              </button>
            </div>

            {!collapsed && (
              <div
                className="text-[11px] tracking-[0.14em] uppercase font-semibold"
                style={{ color: "var(--app-text-soft)" }}
              >
                Navigation
              </div>
            )}
            {baseNav.map((item) => (
              <MenuButton
                key={item.key}
                label={item.label}
                icon={icons[item.key]}
                active={item.active}
                collapsed={collapsed}
                onClick={() => (item.onClick ? item.onClick() : go(item.to))}
              />
            ))}

            {!collapsed && (
              <div
                className="pt-2 text-[11px] tracking-[0.14em] uppercase font-semibold"
                style={{ color: "var(--app-text-soft)" }}
              >
                Social
              </div>
            )}
            {socialNav.map((item) => (
              <MenuButton
                key={item.key}
                label={item.label}
                icon={icons[item.key]}
                active={item.active} // 👈 add this
                collapsed={collapsed}
                disabled={item.disabled}
                badge={item.badge}
                onClick={() => !item.disabled && go(item.to)}
              />
            ))}

            {proNav.length ? (
              <>
                {!collapsed && (
                  <div
                    className="pt-2 text-[11px] tracking-[0.14em] uppercase font-semibold"
                    style={{ color: "var(--app-text-soft)" }}
                  >
                    Pro
                  </div>
                )}
                {proNav.map((item) => (
                  <MenuButton
                    key={item.key}
                    label={item.label}
                    icon={icons[item.key]}
                    active={item.active}
                    collapsed={collapsed}
                    onClick={() => go(item.to)}
                  />
                ))}
              </>
            ) : null}

            {adminNav.length ? (
              <>
                {!collapsed && (
                  <div
                    className="pt-2 text-[11px] tracking-[0.14em] uppercase font-semibold"
                    style={{ color: "var(--app-text-soft)" }}
                  >
                    Admin
                  </div>
                )}
                {adminNav.map((item) => (
                  <MenuButton
                    key={item.key}
                    label={item.label}
                    icon={icons[item.key]}
                    active={item.active}
                    collapsed={collapsed}
                    onClick={() => go(item.to)}
                  />
                ))}
              </>
            ) : null}

            {!collapsed && (
              <div
                className="pt-2 text-[11px] tracking-[0.14em] uppercase font-semibold"
                style={{ color: "var(--app-text-soft)" }}
              >
                Help
              </div>
            )}
            <MenuButton
              label="Legal"
              icon={icons.help}
              collapsed={collapsed}
              onClick={() => go("/legal")}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function MenuButton({
  label,
  icon,
  onClick,
  active = false,
  disabled = false,
  collapsed = false,
  badge = 0,
}) {
  return (
    <button
      type="button"
      onClick={!disabled ? onClick : undefined}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[16px] font-medium transition-colors
  ${disabled ? "opacity-50 cursor-not-allowed" : ""}
  ${collapsed ? "justify-center px-2" : ""}`}
      style={{
        backgroundColor: active ? "#F5C542" : "transparent",
        color: active ? "#000000" : "var(--app-text)",
      }}
      onMouseEnter={(e) => {
        if (!active && !disabled)
          e.currentTarget.style.backgroundColor = "var(--app-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active && !disabled)
          e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {icon ? (
        (() => {
          const Icon = icon;
          return <Icon className={`w-5 h-5 ${collapsed ? "" : "shrink-0"}`} />;
        })()
      ) : (
        <span className="w-5 h-5 rounded bg-zinc-700 inline-block" />
      )}

      {!collapsed && <span className="flex-1 text-left">{label}</span>}

      {active && !collapsed ? (
        <span className="text-[10px]" style={{ color: "#000000" }}>
          ●
        </span>
      ) : null}

      {!collapsed && badge > 0 && (
        <span className="ml-2 bg-red-600 text-white text-[11px] rounded-full px-2 py-0.5 font-semibold min-w-[22px] text-center">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
