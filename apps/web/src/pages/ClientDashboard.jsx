// apps/web/src/pages/ClientDashboard.jsx
import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";

function formatMoney(kobo = 0) {
  const naira = (Number(kobo) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
    }).format(naira);
  } catch {
    return `₦${naira.toLocaleString()}`;
  }
}

function toDate(iso) {
  try {
    return iso ? new Date(iso) : null;
  } catch {
    return null;
  }
}

function formatWhen(iso) {
  const d = toDate(iso);
  return d ? d.toLocaleString() : "ASAP";
}

const VALID_SECTIONS = [
  "all",
  "pending_payment",
  "scheduled",
  "accepted",
  "completed",
  "cancelled",
];

export default function ClientDashboard() {
  const location = useLocation();
  const topRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");

  // 🔎 search + tab state
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState("all");

  async function load() {
    try {
      setLoading(true);
      setErr("");
      const { data } = await api.get("/api/bookings/me");
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
        ? data.items
        : [];
      setItems(list);
    } catch (e) {
      console.error(e);
      setErr("Could not load your bookings.");
    } finally {
      setLoading(false);
    }
  }

  // initial load
  useEffect(() => {
    load();
  }, []);

  // pick initial section from URL hash (#completed, #accepted, etc.)
  useEffect(() => {
    const hash = (location.hash || "").replace("#", "").trim();
    if (VALID_SECTIONS.includes(hash)) {
      setActiveSection(hash);
    }
  }, [location.hash]);

  // counts for tabs
  const counts = useMemo(() => {
    const c = {
      all: items.length,
      pending_payment: 0,
      scheduled: 0,
      accepted: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const b of items) {
      if (b.status && c[b.status] !== undefined) c[b.status] += 1;
    }
    return c;
  }, [items]);

  // filtered + sorted list based on active section + search term
  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();

    const sorted = items.slice().sort((a, b) => {
      const ta = toDate(a.createdAt)?.getTime() ?? 0;
      const tb = toDate(b.createdAt)?.getTime() ?? 0;
      return tb - ta;
    });

    return sorted.filter((b) => {
      if (activeSection !== "all" && b.status !== activeSection) {
        return false;
      }

      if (!term) return true;

      const svcName = (
        b?.service?.serviceName ||
        b?.serviceName ||
        ""
      ).toLowerCase();
      const proName = (b?.proName || b?.pro?.name || "").toLowerCase();
      const lga = String(b?.lga || "").toLowerCase();
      const addr = String(b?.addressText || "").toLowerCase();

      return (
        svcName.includes(term) ||
        proName.includes(term) ||
        lga.includes(term) ||
        addr.includes(term)
      );
    });
  }, [items, activeSection, search]);

  // helper for clicking a tab (also updates #hash and scrolls to top)
  function goSection(key) {
    setActiveSection(key);

    if (typeof window !== "undefined") {
      const newHash = `#${key}`;
      if (window.location.hash !== newHash) {
        window.location.hash = newHash;
      }
      if (topRef.current) {
        try {
          topRef.current.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        } catch {
          /* ignore */
        }
      }
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10" ref={topRef}>
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold">My Bookings</h1>
        <button
          onClick={load}
          className="rounded-lg bg-gold text-black px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* search bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by service, professional or location…"
          className="bg-black border border-zinc-800 rounded-lg px-3 py-2 text-sm w-full sm:w-80"
        />
        <p className="text-xs text-zinc-500">
          Use the tabs below to jump between booking states.
        </p>
      </div>

      {/* hash-based tabs */}
      <div className="flex gap-2 mb-6 flex-wrap text-sm">
        <NavBadge
          id="all"
          active={activeSection === "all"}
          onClick={() => goSection("all")}
        >
          All ({counts.all})
        </NavBadge>
        <NavBadge
          id="scheduled"
          tone="zinc"
          active={activeSection === "scheduled"}
          onClick={() => goSection("scheduled")}
        >
          Scheduled ({counts.scheduled})
        </NavBadge>

        <NavBadge
          id="accepted"
          tone="emerald"
          active={activeSection === "accepted"}
          onClick={() => goSection("accepted")}
        >
          Accepted ({counts.accepted})
        </NavBadge>

        <NavBadge
          id="completed"
          tone="sky"
          active={activeSection === "completed"}
          onClick={() => goSection("completed")}
        >
          Completed ({counts.completed})
        </NavBadge>
        <NavBadge
          id="pending_payment"
          tone="amber"
          active={activeSection === "pending_payment"}
          onClick={() => goSection("pending_payment")}
        >
          Pending payment ({counts.pending_payment})
        </NavBadge>
        <NavBadge
          id="cancelled"
          tone="red"
          active={activeSection === "cancelled"}
          onClick={() => goSection("cancelled")}
        >
          Cancelled ({counts.cancelled})
        </NavBadge>
      </div>

      {err ? (
        <div className="mb-4 rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">
          {err}
        </div>
      ) : null}

      {loading ? (
        <p className="text-zinc-400">Loading…</p>
      ) : filteredItems.length === 0 ? (
        <div className="border border-zinc-800 rounded-xl p-6 text-zinc-400 bg-black/30">
          {items.length === 0
            ? "You don’t have any bookings yet."
            : "No bookings match your filters."}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map((b) => {
            const svcName =
              b?.service?.serviceName || b?.serviceName || "Service";
            const priceKobo = Number.isFinite(Number(b?.amountKobo))
              ? Number(b.amountKobo)
              : Number(b?.service?.priceKobo) || 0;
            const proName = b?.proName || b?.pro?.name || "Your professional";

            return (
              <div
                key={b._id}
                className="border border-zinc-800 rounded-xl p-4 bg-black/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <div>
                    <div className="font-medium">
                      {svcName} • {formatMoney(priceKobo)}
                    </div>
                    <div className="text-sm text-zinc-400">
                      with {proName}
                      {b.lga ? ` • ${b.lga}` : ""}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      {b.scheduledFor
                        ? `Scheduled: ${formatWhen(b.scheduledFor)}`
                        : "No time set"}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <StatusPill status={b.status} />
                    <PayPill paymentStatus={b.paymentStatus} />
                  </div>
                </div>

                {b.addressText ? (
                  <div className="text-xs text-zinc-500 mt-1">
                    {b.addressText}
                  </div>
                ) : null}

                {/* open full booking details (pay / complete / chat / review) */}
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Link
                    to={`/bookings/${b._id}`}
                    className="inline-flex items-center px-3 py-1 rounded-lg border border-zinc-700 hover:bg-zinc-900"
                  >
                    View / Manage
                  </Link>

                  {/* Show Leave Review for completed bookings */}
                  {b.status === "completed" && (b.proId || b.pro?._id) && (
                    <Link
                      to={`/review/${b.proId || b.pro?._id}?bookingId=${b._id}`}
                      className="inline-flex items-center px-3 py-1 rounded-lg border border-sky-700 text-sky-300 hover:bg-sky-950/40"
                    >
                      Leave Review
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---- UI helpers ---- */

function NavBadge({ children, tone = "zinc", active = false, onClick }) {
  const map = {
    zinc: "bg-zinc-900/40 border-zinc-800 text-zinc-200",
    emerald: "bg-emerald-900/30 border-emerald-800 text-emerald-200",
    sky: "bg-sky-900/30 border-sky-800 text-sky-200",
    amber: "bg-amber-900/30 border-amber-800 text-amber-200",
    red: "bg-red-900/30 border-red-800 text-red-200",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full border text-xs transition
        ${map[tone] || map.zinc}
        ${
          active
            ? "ring-1 ring-gold font-semibold"
            : "opacity-80 hover:opacity-100"
        }`}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }) {
  const map = {
    accepted: "bg-emerald-900/30 border-emerald-700 text-emerald-200",
    completed: "bg-sky-900/30 border-sky-700 text-sky-200",
    cancelled: "bg-red-900/30 border-red-700 text-red-200",
    pending_payment: "bg-amber-900/30 border-amber-700 text-amber-200",
    scheduled: "bg-zinc-900/30 border-zinc-700 text-zinc-200",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs border ${
        map[status] || "bg-zinc-900/30 border-zinc-700"
      }`}
    >
      {status || "unknown"}
    </span>
  );
}

function PayPill({ paymentStatus }) {
  const ok = paymentStatus === "paid";
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs border ${
        ok
          ? "bg-emerald-900/30 border-emerald-700 text-emerald-200"
          : "bg-amber-900/30 border-amber-700 text-amber-200"
      }`}
    >
      {paymentStatus || "unpaid"}
    </span>
  );
}
