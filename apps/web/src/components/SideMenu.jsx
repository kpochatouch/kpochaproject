// apps/web/src/components/SideMenu.jsx
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

export default function SideMenu({ me }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(true);

  const isAdmin = !!me?.isAdmin;
  const isPro = !!me?.isPro;

  function go(p) {
    navigate(p);
  }

  return (
    <div className="sticky top-20">
      {/* toggle (mobile / narrow) */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="lg:hidden mb-3 rounded-lg border border-zinc-700 px-3 py-1 text-sm"
      >
        {open ? "Hide menu" : "Menu"}
      </button>

      <div
        className={`transition-all duration-200 ${
          open ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2 pointer-events-none"
        }`}
      >
        <div className="w-60 rounded-xl border border-zinc-800 bg-black/40 p-3 space-y-1">
          <div className="text-[10px] tracking-wide uppercase text-zinc-500 mb-2">
            Navigation
          </div>

          <MenuButton
            label="Feed"
            active={location.pathname === "/browse"}
            onClick={() => go("/browse")}
          />
          <MenuButton label="Browse Pros" onClick={() => go("/browse?tab=pros")} />
          <MenuButton label="Profile" onClick={() => go("/profile")} />
          <MenuButton label="Wallet" onClick={() => go("/wallet")} />
          <MenuButton label="Settings" onClick={() => go("/settings")} />

          {/* future / dummy routes */}
          <div className="pt-2">
            <div className="text-[10px] tracking-wide uppercase text-zinc-500 mb-1">
              Social
            </div>
            <MenuButton label="Chat" onClick={() => go("/chat")} disabled />
            <MenuButton label="For you" onClick={() => go("/browse")} disabled />
          </div>

          {/* pro only */}
          {isPro && (
            <div className="pt-2">
              <div className="text-[10px] tracking-wide uppercase text-zinc-500 mb-1">
                Pro
              </div>
              <MenuButton label="Pro Dashboard" onClick={() => go("/pro-dashboard")} />
              <MenuButton label="Bookings" onClick={() => go("/wallet")} />
            </div>
          )}

          {/* admin only */}
          {isAdmin && (
            <div className="pt-2">
              <div className="text-[10px] tracking-wide uppercase text-zinc-500 mb-1">
                Admin
              </div>
              <MenuButton label="Admin Panel" onClick={() => go("/admin")} />
              <MenuButton label="Risk / Logs" onClick={() => go("/admin")} disabled />
            </div>
          )}

          <div className="pt-2">
            <div className="text-[10px] tracking-wide uppercase text-zinc-500 mb-1">
              Help
            </div>
            <MenuButton label="Legal" onClick={() => go("/legal")} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuButton({ label, onClick, active = false, disabled = false }) {
  return (
    <button
      onClick={!disabled ? onClick : undefined}
      className={`w-full text-left px-2 py-2 rounded-lg text-sm flex items-center justify-between
        ${active ? "bg-zinc-900 text-gold" : "text-zinc-200 hover:bg-zinc-900"}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
    >
      <span>{label}</span>
      {active ? (
        <span className="text-[8px]">●</span>
      ) : null}
    </button>
  );
}
