// apps/web/src/pages/ClientDashboard.jsx
import { useEffect, useState, useMemo } from "react";
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

export default function ClientDashboard() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setLoading(true);
      setErr("");
      // NOTE: if your backend uses a different path, we’ll change this later
      const { data } = await api.get("/api/bookings/me");
      const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      setItems(list);
    } catch (e) {
      console.error(e);
      setErr("Could not load your bookings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => {
    const c = { all: items.length, accepted: 0, completed: 0, cancelled: 0, pending_payment: 0 };
    for (const b of items) {
      if (b.status && c[b.status] !== undefined) c[b.status] += 1;
    }
    return c;
  }, [items]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold">My Bookings</h1>
        <button
          onClick={load}
          className="rounded-lg bg-gold text-black px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap text-sm">
        <Badge>All ({counts.all})</Badge>
        <Badge tone="emerald">Accepted ({counts.accepted})</Badge>
        <Badge tone="sky">Completed ({counts.completed})</Badge>
        <Badge tone="amber">Pending payment ({counts.pending_payment})</Badge>
        <Badge tone="red">Cancelled ({counts.cancelled})</Badge>
      </div>

      {err ? (
        <div className="mb-4 rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">
          {err}
        </div>
      ) : null}

      {loading ? (
        <p className="text-zinc-400">Loading…</p>
      ) : items.length === 0 ? (
        <div className="border border-zinc-800 rounded-xl p-6 text-zinc-400 bg-black/30">
          You don’t have any bookings yet.
        </div>
      ) : (
        <div className="space-y-4">
          {items
            .slice()
            .sort((a, b) => {
              const ta = toDate(a.createdAt)?.getTime() ?? 0;
              const tb = toDate(b.createdAt)?.getTime() ?? 0;
              return tb - ta;
            })
            .map((b) => {
              const svcName = b?.service?.serviceName || b?.serviceName || "Service";
              const priceKobo =
                Number.isFinite(Number(b?.amountKobo))
                  ? Number(b.amountKobo)
                  : Number(b?.service?.priceKobo) || 0;
              const proName = b?.proName || b?.pro?.name || "Your professional";

              return (
                <div key={b._id} className="border border-zinc-800 rounded-xl p-4 bg-black/40">
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
                        {b.scheduledFor ? `Scheduled: ${formatWhen(b.scheduledFor)}` : "No time set"}
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <StatusPill status={b.status} />
                      <PayPill paymentStatus={b.paymentStatus} />
                    </div>
                  </div>
                  {b.addressText ? (
                    <div className="text-xs text-zinc-500 mt-1">{b.addressText}</div>
                  ) : null}
                  {/* later we can add: “Open chat” → /booking-chat?id=... */}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function Badge({ children, tone = "zinc" }) {
  const map = {
    zinc: "bg-zinc-900/40 border-zinc-800",
    emerald: "bg-emerald-900/30 border-emerald-800",
    sky: "bg-sky-900/30 border-sky-800",
    amber: "bg-amber-900/30 border-amber-800",
    red: "bg-red-900/30 border-red-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full border text-xs ${map[tone] || map.zinc}`}>
      {children}
    </span>
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
    <span className={`px-2 py-0.5 rounded-full text-xs border ${map[status] || "bg-zinc-900/30 border-zinc-700"}`}>
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
