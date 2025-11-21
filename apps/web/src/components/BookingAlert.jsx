// apps/web/src/components/BookingAlert.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { getProBookings, acceptBooking } from "../lib/api";
import { Link } from "react-router-dom";

/**
 * BookingAlert
 * - Polls bookings assigned to the signed-in pro (every 20s by default)
 * - Shows a compact alert when a NEW booking appears (status scheduled/pending_payment)
 * - Optional chime (off by default)
 *
 * Props:
 *   pollMs?: number        (default 20000)
 *   playSound?: boolean    (default false)
 *   soundSrc?: string      (custom audio file if playSound is true)
 */
export default function BookingAlert({ pollMs = 20000, playSound = false, soundSrc }) {
  const [queue, setQueue] = useState([]); // alerts to show (FIFO)
  const [busy, setBusy] = useState(false);
  const audioRef = useRef(null);

  // Used to remember what we’ve already alerted about (latest timestamp)
  const STORAGE_KEY = "pro:lastBookingAlertAt";

  const current = queue.length ? queue[0] : null;

  // Prepare sound (lazy)
  useEffect(() => {
    if (!playSound) return;
    if (!audioRef.current) {
      const a = new Audio(soundSrc || "/chime.mp3");
      a.preload = "auto";
      audioRef.current = a;
    }
  }, [playSound, soundSrc]);

  // Poll bookings
  useEffect(() => {
    let alive = true;
    let timer;

    async function tick() {
      try {
        const data = await getProBookings(); // array
        if (!alive) return;

        // Actionable to notify: 'scheduled' (always), 'pending_payment' (heads-up; accept disabled if unpaid)
        const actionable = (Array.isArray(data) ? data : []).filter((b) =>
          ["scheduled", "pending_payment"].includes(b.status)
        );

        // last time (ms) we alerted
        const lastAtMs = Number(localStorage.getItem(STORAGE_KEY) || 0);

        // normalize created time (prefer createdAt; fallback to updatedAt or now)
        const norm = actionable.map((b) => ({
          ...b,
          _createdMs: new Date(b.createdAt || b.updatedAt || Date.now()).getTime(),
        }));

        // Only push items newer than watermark, and avoid duplicates already queued
        const existingIds = new Set(queue.map((q) => q._id));
        const fresh = norm
          .filter((b) => b._createdMs > lastAtMs && !existingIds.has(b._id))
          .sort((a, b) => b._createdMs - a._createdMs); // newest first

        if (fresh.length) {
          setQueue((q) => [...q, ...fresh]);

          // watermark = newest created time from this batch
          localStorage.setItem(STORAGE_KEY, String(fresh[0]._createdMs));

          if (playSound && audioRef.current) {
            try {
              audioRef.current.currentTime = 0;
              audioRef.current.play();
            } catch {}
          }
        }
      } catch {
        // silent fail
      } finally {
        if (alive) timer = setTimeout(tick, pollMs);
      }
    }

    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [pollMs, playSound, queue]);

  async function onAccept(id) {
    setBusy(true);
    try {
      await acceptBooking(id);
      // remove current alert from queue
      setQueue((q) => q.slice(1));
    } catch (e) {
      alert("Could not accept booking. Ensure payment is 'paid'.");
    } finally {
      setBusy(false);
    }
  }

  function onDismiss() {
    setQueue((q) => q.slice(1));
  }

  // Read fields safely (instant flow stores a service snapshot)
  const svcName = useMemo(() => {
    if (!current) return "Service";
    return current.service?.serviceName || current.serviceName || "Service";
  }, [current]);

  const amountKobo = useMemo(() => {
    if (!current) return 0;
    // prefer top-level amountKobo written by server; fallback to service snapshot price
    if (Number.isFinite(Number(current.amountKobo))) return Number(current.amountKobo);
    if (Number.isFinite(Number(current.service?.priceKobo))) return Number(current.service.priceKobo);
    return 0;
  }, [current]);

  const whenText = useMemo(() => {
    if (!current) return "";
    // Instant booking may have scheduledFor === null
    if (!current.scheduledFor) return "ASAP";
    return formatDate(current.scheduledFor);
  }, [current]);

  const lgaText = useMemo(() => {
    if (!current) return "";
    return current.lga || "";
  }, [current]);

  const canAccept = useMemo(() => {
    if (!current) return false;
    return (
      current.paymentStatus === "paid" &&
      (current.status === "scheduled" || current.status === "pending_payment")
    );
  }, [current]);

  if (!current) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[22rem] rounded-xl border border-amber-700 bg-black/80 backdrop-blur p-4 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-amber-300 mb-1">New booking available</div>
          <div className="font-medium">
            {svcName} • {formatMoney(amountKobo)}
          </div>
          <div className="text-xs text-zinc-400 mt-0.5">
            {whenText} • {lgaText}
          </div>
          {/* Private client contact is not shown here; becomes visible to pro after ACCEPT. */}
        </div>

        <button
          onClick={onDismiss}
          className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          disabled={!canAccept || busy}
          onClick={() => onAccept(current._id)}
          className="rounded-lg border border-emerald-700 text-emerald-300 px-3 py-1.5 text-sm hover:bg-emerald-950/40 disabled:opacity-40"
          title={canAccept ? "Accept booking" : "Payment not confirmed yet"}
        >
          {busy ? "Working…" : "Accept"}
        </button>

        {/* If you have a booking details page, link it here. Otherwise keep dashboard link. */}
        <Link
          to={`/bookings/${current._id}`}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
          title="Open booking details"
          onClick={onDismiss}
        >
          View Details
        </Link>

        <Link
          to="/pro"
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
          title="Open dashboard"
          onClick={onDismiss}
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}

/* ---- tiny local formatters ---- */
function formatMoney(kobo = 0) {
  const naira = (Number(kobo) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(naira);
  } catch {
    return `₦${naira.toLocaleString()}`;
  }
}
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso || "";
  }
}
