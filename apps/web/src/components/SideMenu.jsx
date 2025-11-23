// apps/web/src/components/SideMenu.jsx
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const icons = {
  feed: "/menu/feed.png",
  browse: "/menu/browse-pros.png",
  instant: "/menu/bookings.png",
  profile: "/menu/profile.png",
  wallet: "/menu/wallet.png",
  settings: "/menu/settings.png",
  bookings: "/menu/bookings.png",
  pro: "/menu/pro.png",
  chat: "/menu/chat.png",
  foryou: "/menu/for-you.png",
  risk: "/menu/risk-logs.png",
  admin: "/menu/admin.png",
  help: "/menu/settings.png",
};

export default function SideMenu({ me }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const isAdmin = !!me?.isAdmin;
  const isPro = !!me?.isPro;

  const pathname = location.pathname;
  const search = location.search || "";
  const isFeed = pathname === "/browse" && !search.includes("tab=pros");
  const isBrowsePros =
    pathname === "/browse" && search.includes("tab=pros");

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

    // Instant Request – only when logged in
    me && {
      key: "instant",
      label: "Instant Request",
      icon: icons.instant,
      active: pathname === "/instant-request",
      onClick: () => {
        navigate("/instant-request", {
          state: { mode: "wildcard" },
        });
        setOpen(false);
      },
    },

    me && {
      key: "profile",
      label: "Profile",
      to: "/profile",
      active: pathname === "/profile",
    },

    // ✅ NEW: My Bookings (client bookings)
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

    // ✅ Only show Become a Pro when user is not already a pro
    me && !isPro && {
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
      to: "/chat",
      disabled: true,
    },
    {
      key: "foryou",
      label: "For You",
      to: "/browse",
      disabled: true,
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
        onClick={() => setOpen((o) => !o)}
        className="lg:hidden mb-3 rounded-lg border border-zinc-700 px-3 py-1 text-sm bg-black/50"
      >
        {open ? "Close menu" : "Menu"}
      </button>

      <div className="relative">
        {open && (
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-30 lg:hidden"
            onClick={() => setOpen(false)}
          />
        )}

        <div
          className={`${
            open ? "translate-x-0" : "-translate-x-full"
          } lg:translate-x-0 lg:!transform-none transition-transform duration-200
             fixed lg:sticky top-16 lg:top-20 left-0 z-40
             h-[calc(100vh-4rem)] lg:h-auto
             flex`}
        >
          <div
            className={`${
              collapsed ? "w-14" : "w-60"
            } bg-black/70 border-r border-zinc-800 h-full lg:h-auto
              rounded-none lg:rounded-xl lg:border lg:bg-black/40
              p-3 space-y-2 overflow-y-auto`}
          >
            {/* collapse toggle */}
            <div className="hidden lg:flex justify-end mb-1">
              <button
                onClick={() => setCollapsed((c) => !c)}
                className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-900"
                title={collapsed ? "Expand" : "Collapse"}
              >
                {collapsed ? "»" : "«"}
              </button>
            </div>

            {!collapsed && (
              <div className="text-[10px] tracking-wide uppercase text-zinc-500">
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
                onClick={() => item.onClick ? item.onClick() : go(item.to)}
              />
            ))}

            {!collapsed && (
              <div className="pt-1 text-[10px] tracking-wide uppercase text-zinc-500">
                Social
              </div>
            )}
            {socialNav.map((item) => (
              <MenuButton
                key={item.key}
                label={item.label}
                icon={icons[item.key]}
                collapsed={collapsed}
                disabled={item.disabled}
                onClick={() => !item.disabled && go(item.to)}
              />
            ))}

            {proNav.length ? (
              <>
                {!collapsed && (
                  <div className="pt-1 text-[10px] tracking-wide uppercase text-zinc-500">
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
                  <div className="pt-1 text-[10px] tracking-wide uppercase text-zinc-500">
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
              <div className="pt-1 text-[10px] tracking-wide uppercase text-zinc-500">
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
}) {
  return (
    <button
      onClick={!disabled ? onClick : undefined}
      className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm
        ${active ? "bg-zinc-900 text-gold" : "text-zinc-200 hover:bg-zinc-900"}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        ${collapsed ? "justify-center" : ""}`}
    >
      {icon ? (
        <img
          src={icon}
          alt=""
          className={`w-5 h-5 object-contain ${collapsed ? "" : "shrink-0"}`}
        />
      ) : (
        <span className="w-5 h-5 rounded bg-zinc-700 inline-block" />
      )}
      {!collapsed && <span className="flex-1 text-left">{label}</span>}
      {active && !collapsed ? <span className="text-[8px]">●</span> : null}
    </button>
  );
}
