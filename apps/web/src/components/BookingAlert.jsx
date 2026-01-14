// apps/web/src/components/BookingAlert.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getProBookings,
  acceptBooking,
  registerSocketHandler,
} from "../lib/api";
import { Link } from "react-router-dom";

export default function BookingAlert({
  pollMs = 20000,
  playSound = false,
  soundSrc,
}) {
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);

  const audioRef = useRef(null);
  const queueRef = useRef([]); // avoid stale closure
  const STORAGE_KEY = "pro:lastBookingAlertAt";

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // Prepare sound (lazy)
  useEffect(() => {
    if (!playSound) return;
    if (!audioRef.current) {
      const a = new Audio(soundSrc || "/chime.mp3");
      a.preload = "auto";
      audioRef.current = a;
    }
  }, [playSound, soundSrc]);

  async function refreshAndEnqueue() {
    try {
      const data = await getProBookings();

      // STRICT actionable: scheduled + paid
      const actionable = (Array.isArray(data) ? data : []).filter(
        (b) => b.status === "scheduled" && b.paymentStatus === "paid",
      );

      const lastAtMs = Number(localStorage.getItem(STORAGE_KEY) || 0);

      const norm = actionable.map((b) => ({
        ...b,
        _createdMs: new Date(
          b.createdAt || b.updatedAt || Date.now(),
        ).getTime(),
      }));

      const existingIds = new Set(queueRef.current.map((q) => q._id));

      const fresh = norm
        .filter((b) => b._createdMs > lastAtMs && !existingIds.has(b._id))
        .sort((a, b) => b._createdMs - a._createdMs);

      if (fresh.length) {
        setQueue((q) => [...q, ...fresh]);
        localStorage.setItem(STORAGE_KEY, String(fresh[0]._createdMs));

        if (playSound && audioRef.current) {
          try {
            audioRef.current.currentTime = 0;
            audioRef.current.play();
          } catch {}
        }
      }
    } catch {
      // ignore; polling will catch later
    }
  }

  // Socket-first: booking paid -> refresh
  useEffect(() => {
    const off = registerSocketHandler("booking:paid", () => {
      refreshAndEnqueue();
    });
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSound]); // NOT queue

  // Poll fallback
  useEffect(() => {
    let alive = true;
    let timer;

    async function tick() {
      await refreshAndEnqueue();
      if (alive) timer = setTimeout(tick, pollMs);
    }

    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, playSound]);

  async function onAccept(id) {
    setBusy(true);
    try {
      await acceptBooking(id);
      setQueue((q) => q.slice(1));
    } catch {
      alert("Could not accept booking. Ensure payment is 'paid'.");
    } finally {
      setBusy(false);
    }
  }

  function onDismiss() {
    setQueue((q) => q.slice(1));
  }

  const current = queue.length ? queue[0] : null;

  const svcName = useMemo(() => {
    if (!current) return "Service";
    return current.service?.serviceName || current.serviceName || "Service";
  }, [current]);

  const amountKobo = useMemo(() => {
    if (!current) return 0;
    if (Number.isFinite(Number(current.amountKobo)))
      return Number(current.amountKobo);
    if (Number.isFinite(Number(current.service?.priceKobo)))
      return Number(current.service.priceKobo);
    return 0;
  }, [current]);

  const whenText = useMemo(() => {
    if (!current) return "";
    if (!current.scheduledFor) return "ASAP";
    return formatDate(current.scheduledFor);
  }, [current]);

  const lgaText = useMemo(() => {
    if (!current) return "";
    return current.lga || "";
  }, [current]);

  const canAccept = useMemo(() => {
    if (!current) return false;
    return current.paymentStatus === "paid" && current.status === "scheduled";
  }, [current]);

  if (!current) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[22rem] rounded-xl border border-amber-700 bg-black/80 backdrop-blur p-4 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-amber-300 mb-1">
            New booking available
          </div>
          <div className="font-medium">
            {svcName} • {formatMoney(amountKobo)}
          </div>
          <div className="text-xs text-zinc-400 mt-0.5">
            {whenText} • {lgaText}
          </div>
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

        <Link
          to={`/bookings/${current._id}`}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
          title="Open booking details"
          onClick={onDismiss}
        >
          View Details
        </Link>

        <Link
          to="/pro-dashboard"
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
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso || "";
  }
}
