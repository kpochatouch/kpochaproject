// apps/web/src/pages/ProDashboard.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getProBookings,
  acceptBooking,
  completeBooking,
  cancelBookingByPro,
} from "../lib/api";
import { Link } from "react-router-dom";

/* ---------- utils ---------- */
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

const TONE = {
  zinc: "bg-zinc-900/40 border-zinc-800",
  emerald: "bg-emerald-900/30 border-emerald-800",
  amber: "bg-amber-900/30 border-amber-800",
  sky: "bg-sky-900/30 border-sky-800",
};

const Badge = ({ children, color = "zinc" }) => (
  <span
    className={`px-2 py-0.5 rounded-full text-xs font-medium ${TONE[color]}`}
  >
    {children}
  </span>
);

const PRO_FALLBACK_MINUTES = 120; // 2 hours before pro can close job

/* ---------- page ---------- */
export default function ProDashboard() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [tab, setTab] = useState("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef(null);
  const okTimer = useRef(null);

  // Derived counts
  const counts = useMemo(() => {
    const c = { all: items.length };
    for (const s of [
      "scheduled",
      "accepted",
      "completed",
      "pending_payment",
      "cancelled",
    ]) {
      c[s] = items.filter((b) => b.status === s).length;
    }
    return c;
  }, [items]);

  // Filter + sort by scheduled time (earliest first; ASAP treated as earliest)
  const filtered = useMemo(() => {
    const arr = tab === "all" ? items : items.filter((b) => b.status === tab);
    const key = (b) => toDate(b.scheduledFor)?.getTime() ?? 0;
    return arr.slice().sort((a, b) => key(a) - key(b));
  }, [items, tab]);

  function flashOK(msg) {
    setOk(msg);
    clearTimeout(okTimer.current);
    okTimer.current = setTimeout(() => setOk(""), 2000);
  }

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

  // initial + optional auto refresh
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    clearInterval(timerRef.current);
    if (autoRefresh) {
      timerRef.current = setInterval(load, 30000);
    }
    return () => clearInterval(timerRef.current);
  }, [autoRefresh]);

  // actions
  async function onAccept(id) {
    try {
      // optimistic: flip just this one to accepted
      setItems((prev) =>
        prev.map((b) =>
          b._id === id
            ? {
                ...b,
                status: "accepted",
                acceptedAt: new Date().toISOString(),
              }
            : b
        )
      );
      await acceptBooking(id);
      flashOK("Booking accepted.");
    } catch (e) {
      console.error(e);
      setErr("Could not accept booking. Ensure payment is 'paid'.");
      // reload to be safe
      load();
    }
  }

  // Pro-only completion (fallback after 2 hours)
  async function onCompleteAsPro(id, askNote = false) {
    try {
      const payload = {};
      if (askNote) {
        const note = window.prompt(
          "Optional: add a brief note about this completion (e.g. client did not click complete, but job is done). Leave blank to continue.",
          ""
        );
        if (note && note.trim()) {
          // backend accepts completionNote or note; either works
          payload.completionNote = note.trim();
        }
      }

      const res = await completeBooking(id, payload);

      if (res?.action === "requested_client_completion") {
        flashOK("Client notified to complete the booking.");
        load();
        return;
      }

      flashOK("Booking completed.");
      load();
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.message || e?.response?.data?.error;
      setErr(
        msg === "client_must_complete_first"
          ? "Client must mark completed first. If they don’t respond, you can complete after the fallback time."
          : msg || "Could not complete booking."
      );
      load();
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold">Pro Dashboard</h1>
        <div className="flex items-center gap-2">
          <select
            value={tab}
            onChange={(e) => setTab(e.target.value)}
            className="bg-black border border-zinc-800 rounded-lg px-2 py-1 text-sm"
            title="Filter by status"
          >
            <option value="all">All ({counts.all})</option>
            <option value="scheduled">Scheduled ({counts.scheduled})</option>
            <option value="accepted">Accepted ({counts.accepted})</option>
            <option value="completed">Completed ({counts.completed})</option>
            <option value="pending_payment">
              Pending payment ({counts.pending_payment})
            </option>
            <option value="cancelled">Cancelled ({counts.cancelled})</option>
          </select>
          <label className="text-sm inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button
            onClick={load}
            className="rounded-lg bg-gold text-black px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded border border-red-800 bg-red-900/40 text-red-100 px-3 py-2">
          {err}
        </div>
      )}
      {ok && (
        <div className="mb-4 rounded border border-green-800 bg-green-900/30 text-green-100 px-3 py-2">
          {ok}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="border border-zinc-800 rounded-xl p-6 text-zinc-400">
          No bookings assigned to you yet.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((b) => {
            // Snapshot vs legacy
            const svcName =
              b?.service?.serviceName || b?.serviceName || "Service";
            const priceKobo = Number.isFinite(Number(b?.amountKobo))
              ? Number(b.amountKobo)
              : Number(b?.service?.priceKobo) || 0;

            const paidTone = b.paymentStatus === "paid" ? "emerald" : "amber";
            const statusTone =
              b.status === "scheduled"
                ? "sky"
                : b.status === "accepted"
                ? "emerald"
                : b.status === "completed"
                ? "emerald"
                : b.status === "cancelled"
                ? "amber"
                : "amber";

            const canAccept =
              b.paymentStatus === "paid" && b.status === "scheduled";

            // 2-hour rule: how long since accepted?
            const acceptedAt = toDate(b.acceptedAt);
            const minutesSinceAccepted = acceptedAt
              ? Math.floor((Date.now() - acceptedAt.getTime()) / 60000)
              : null;

            // Pro is only allowed to complete as a fallback after 2 hours
            const proCanCompleteFallback =
              b.status === "accepted" &&
              minutesSinceAccepted !== null &&
              minutesSinceAccepted >= PRO_FALLBACK_MINUTES;

            const completedByLabel =
              b.meta?.completedBy === "client"
                ? "client"
                : b.meta?.completedBy === "pro"
                ? "professional"
                : b.meta?.completedBy === "admin"
                ? "admin"
                : null;

            return (
              <div
                key={b._id}
                className="border border-zinc-800 rounded-xl p-4 bg-black/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      <Link
                        to={`/bookings/${b._id}`}
                        className="hover:underline"
                        title="Open full booking details"
                      >
                        {svcName} • {formatMoney(priceKobo)}
                      </Link>
                    </div>

                    <div className="text-sm text-zinc-400">
                      {formatWhen(b.scheduledFor)} — {b.lga}
                    </div>
                    {b.addressText ? (
                      <div className="text-sm text-zinc-500 mt-1">
                        {b.addressText}
                      </div>
                    ) : null}
                    {b.clientName || b.client?.name ? (
                      <div className="text-xs text-zinc-500 mt-1">
                        Client: {b.clientName || b.client?.name}
                        {/* NOTE: Pro is NOT allowed to see phone numbers */}
                      </div>
                    ) : null}

                    {b.status === "accepted" && !proCanCompleteFallback && (
                      <div className="text-xs text-zinc-500 mt-1">
                        Waiting for client to mark this job as completed.
                      </div>
                    )}

                    {proCanCompleteFallback && (
                      <div className="text-xs text-amber-400 mt-1">
                        Client has not marked this as completed for about{" "}
                        {minutesSinceAccepted} minutes. You may close it as
                        completed if the job is truly done (optional note will
                        be saved for admin).
                      </div>
                    )}

                    {b.status === "completed" && completedByLabel && (
                      <div className="text-xs text-zinc-500 mt-1">
                        Completed by:{" "}
                        <span className="font-semibold">
                          {completedByLabel}
                        </span>
                        {b.meta?.completionNote
                          ? ` — Note: ${b.meta.completionNote}`
                          : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color={paidTone}>{b.paymentStatus}</Badge>
                    <Badge color={statusTone}>{b.status}</Badge>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {/* Scheduled + paid: show Accept + Decline */}
                  {b.paymentStatus === "paid" && b.status === "scheduled" ? (
                    <>
                      <button
                        onClick={() => onAccept(b._id)}
                        className="rounded-lg border border-emerald-700 text-emerald-300 px-3 py-1.5 text-sm hover:bg-emerald-950/40"
                        title="Accept the job"
                      >
                        Accept
                      </button>

                      <button
                        onClick={async () => {
                          const reason =
                            window.prompt("Reason (optional):", "") || "";
                          try {
                            await cancelBookingByPro(b._id, { reason });
                            flashOK("Booking declined (client refunded).");
                            load();
                          } catch (e) {
                            console.error(e);
                            setErr("Could not decline booking.");
                            load();
                          }
                        }}
                        className="rounded-lg border border-amber-700 text-amber-300 px-3 py-1.5 text-sm hover:bg-amber-950/40"
                        title="Decline (refund client)"
                      >
                        Decline
                      </button>
                    </>
                  ) : null}

                  {/* Accepted + paid: show Cancel */}
                  {b.paymentStatus === "paid" && b.status === "accepted" ? (
                    <button
                      onClick={async () => {
                        const reason =
                          window.prompt("Reason (optional):", "") || "";
                        try {
                          await cancelBookingByPro(b._id, { reason });
                          flashOK("Booking cancelled (client refunded).");
                          setItems((prev) =>
                            prev.filter((x) => x._id !== b._id)
                          );
                        } catch (e) {
                          console.error(e);
                          setErr("Could not cancel booking.");
                          load();
                        }
                      }}
                      className="rounded-lg border border-amber-700 text-amber-300 px-3 py-1.5 text-sm hover:bg-amber-950/40"
                      title="Cancel after accepting (refund client)"
                    >
                      Cancel
                    </button>
                  ) : null}

                  {/* If unpaid or other states, show the hint */}
                  {b.paymentStatus !== "paid" &&
                  b.status === "pending_payment" ? (
                    <span
                      className="rounded-lg border border-zinc-800 text-zinc-500 px-3 py-1.5 text-sm"
                      title="You can accept only after payment is confirmed"
                    >
                      Awaiting payment
                    </span>
                  ) : null}

                  {proCanCompleteFallback && (
                    <button
                      onClick={() => onCompleteAsPro(b._id, true)}
                      className="rounded-lg border border-sky-700 text-sky-300 px-3 py-1.5 text-sm hover:bg-sky-950/40"
                      title="Client not responding – close job and (optionally) add a note"
                    >
                      Close job & add note
                    </button>
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
