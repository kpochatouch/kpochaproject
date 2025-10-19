// apps/web/src/pages/ProDashboard.jsx
import { useEffect, useMemo, useState } from "react";
import { getProBookings, acceptBooking, completeBooking } from "../lib/api";

function formatMoney(kobo = 0) {
  const naira = (Number(kobo) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(naira);
  } catch {
    return `₦${naira.toLocaleString()}`;
  }
}
function formatWhen(iso) {
  if (!iso) return "ASAP";
  try { return new Date(iso).toLocaleString(); } catch { return iso || "ASAP"; }
}

const tone = {
  zinc: "bg-zinc-900/40 border-zinc-800",
  emerald: "bg-emerald-900/30 border-emerald-800",
  amber: "bg-amber-900/30 border-amber-800",
  sky: "bg-sky-900/30 border-sky-800",
};
const Badge = ({ children, color = "zinc" }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tone[color]}`}>{children}</span>
);

export default function ProDashboard() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("all");

  const filtered = useMemo(() => {
    if (tab === "all") return items;
    return items.filter((b) => b.status === tab);
  }, [items, tab]);

  async function load() {
    try {
      setLoading(true);
      setErr("");
      const data = await getProBookings();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setErr("Could not load bookings for this professional.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function onAccept(id) {
    try {
      await acceptBooking(id);
      await load();
      alert("Booking accepted.");
    } catch (e) {
      console.error(e);
      alert("Could not accept booking. Ensure payment is 'paid'.");
    }
  }
  async function onComplete(id) {
    try {
      await completeBooking(id);
      await load();
      alert("Booking completed.");
    } catch (e) {
      console.error(e);
      alert("Could not complete booking.");
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Pro Dashboard</h1>
        <div className="flex items-center gap-2">
          <select
            value={tab}
            onChange={(e) => setTab(e.target.value)}
            className="bg-black border border-zinc-800 rounded-lg px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            <option value="scheduled">Scheduled</option>
            <option value="accepted">Accepted</option>
            <option value="completed">Completed</option>
            <option value="pending_payment">Pending payment</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button
            onClick={load}
            className="rounded-lg bg-gold text-black px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {err && <p className="text-red-400 mb-4">{err}</p>}

      {loading ? (
        <p className="text-zinc-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="border border-zinc-800 rounded-xl p-6 text-zinc-400">
          No bookings assigned to you yet.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((b) => {
            // Read from snapshot first, then legacy
            const svcName = b?.service?.serviceName || b?.serviceName || "Service";
            const priceKobo =
              Number.isFinite(Number(b?.amountKobo))
                ? Number(b.amountKobo)
                : Number(b?.service?.priceKobo) || 0;

            const paidTone = b.paymentStatus === "paid" ? "emerald" : "amber";
            const statusTone =
              b.status === "scheduled" ? "sky" :
              b.status === "accepted" ? "emerald" :
              b.status === "completed" ? "emerald" :
              b.status === "cancelled" ? "amber" : "amber";

            const canAccept =
              b.paymentStatus === "paid" &&
              (b.status === "scheduled" || b.status === "pending_payment");

            const canComplete = b.status === "accepted" || b.status === "scheduled";

            return (
              <div key={b._id} className="border border-zinc-800 rounded-xl p-4 bg-black/40">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {svcName} • {formatMoney(priceKobo)}
                    </div>
                    <div className="text-sm text-zinc-400">
                      {formatWhen(b.scheduledFor)} — {b.lga}
                    </div>
                    {b.addressText ? (
                      <div className="text-sm text-zinc-500 mt-1">{b.addressText}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color={paidTone}>{b.paymentStatus}</Badge>
                    <Badge color={statusTone}>{b.status}</Badge>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => onAccept(b._id)}
                    disabled={!canAccept}
                    className="rounded-lg border border-emerald-700 text-emerald-300 px-3 py-1.5 text-sm hover:bg-emerald-950/40 disabled:opacity-40"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onComplete(b._id)}
                    disabled={!canComplete}
                    className="rounded-lg border border-sky-700 text-sky-300 px-3 py-1.5 text-sm hover:bg-sky-950/40 disabled:opacity-40"
                  >
                    Complete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
