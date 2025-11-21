// apps/web/src/pages/BookingDetails.jsx

// Shows one booking by :id for BOTH clients and pros.
// - Loads viewer identity (/api/me) to know if they’re a pro
// - Finds the booking from "my bookings" (client) and/or "pro bookings" (pro)
// - Respects privacy: clientContactPrivate is only visible to a pro AFTER accept
// - Client can pay if unpaid (Wallet OR Paystack inline)
// - Pro can Accept / Complete with the same rules as dashboard

import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  api,
  getMe,
  getMyBookings,
  getProBookings,
  acceptBooking,
  completeBooking,
  verifyPayment,
  payBookingWithWallet, // 👈 ADD THIS
} from "../lib/api";
import PaymentMethodPicker from "../components/PaymentMethodPicker.jsx";

/* -------- shared helpers -------- */
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
function formatWhen(iso) {
  if (!iso) return "ASAP";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso || "ASAP";
  }
}

/* -------- Paystack loader (same idea as BookService) -------- */
function usePaystackReady() {
  const [ready, setReady] = useState(!!window.PaystackPop);
  useEffect(() => {
    if (window.PaystackPop) {
      setReady(true);
      return;
    }
    const id = "paystack-inline-sdk";
    if (document.getElementById(id)) return;
    const s = document.createElement("script");
    s.id = id;
    s.src = "https://js.paystack.co/v1/inline.js";
    s.async = true;
    s.onload = () => setReady(!!window.PaystackPop);
    document.body.appendChild(s);
  }, []);
  return ready;
}

export default function BookingDetails() {
  const { id } = useParams();

  const [me, setMe] = useState(null);
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [payMethod, setPayMethod] = useState("wallet"); // "wallet" | "card"
  const paystackReady = usePaystackReady();

  // derived (supports new snapshot + legacy fields)
  const svcName = useMemo(
    () =>
      booking?.service?.serviceName ||
      booking?.serviceName ||
      "Service",
    [booking]
  );
  const priceKobo = useMemo(
    () =>
      Number.isFinite(Number(booking?.amountKobo))
        ? Number(booking.amountKobo)
        : Number(booking?.service?.priceKobo) || 0,
    [booking]
  );

  const isClient = useMemo(
    () => !!me && booking && me.uid === booking.clientUid,
    [me, booking]
  );
  const isProOwner = useMemo(
    () => !!me && booking && me.uid === booking.proOwnerUid,
    [me, booking]
  );

  const canAccept = useMemo(
    () =>
      isProOwner &&
      booking?.paymentStatus === "paid" &&
      (booking?.status === "scheduled" ||
        booking?.status === "pending_payment"),
    [isProOwner, booking]
  );
  const canComplete = useMemo(
    () =>
      isProOwner &&
      (booking?.status === "accepted" ||
        booking?.status === "scheduled"),
    [isProOwner, booking]
  );

  const canClientPay = useMemo(
    () =>
      isClient &&
      booking?.paymentStatus !== "paid" &&
      (booking?.status === "pending_payment" ||
        booking?.status === "scheduled"),
    [isClient, booking]
  );

  // Load viewer + booking (from lists, since API may not have GET /bookings/:id)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr("");

        const viewer = await getMe().catch(() => null);
        if (!alive) return;
        setMe(viewer);

        let found = null;

        // 1) Client list
        try {
          const mine = await getMyBookings();
          found =
            (mine || []).find(
              (b) => String(b._id) === String(id)
            ) || found;
        } catch {}

        // 2) Pro list (if pro)
        if (!found && viewer?.isPro) {
          try {
            const proItems = await getProBookings();
            found =
              (proItems || []).find(
                (b) => String(b._id) === String(id)
              ) || found;
          } catch {}
        }

        // 3) Optional direct GET if you add it later
        if (!found) {
          try {
            const { data } = await api.get(
              `/api/bookings/${encodeURIComponent(id)}`
            );
            found = data || found;
          } catch {}
        }

        if (!alive) return;
        if (!found) {
          setErr(
            "Booking not found or you do not have permission to view it."
          );
        } else {
          setBooking(found);
        }
      } catch {
        if (alive) setErr("Unable to load booking.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  async function onAccept() {
    if (!booking) return;
    setBusy(true);
    try {
      const updated = await acceptBooking(booking._id);
      setBooking(updated);
      alert("Booking accepted.");
    } catch {
      alert(
        "Could not accept booking. Ensure payment is 'paid'."
      );
    } finally {
      setBusy(false);
    }
  }

  async function onComplete() {
    if (!booking) return;
    setBusy(true);
    try {
      const updated = await completeBooking(booking._id);
      setBooking(updated);
      alert("Booking completed.");
    } catch {
      alert("Could not complete booking.");
    } finally {
      setBusy(false);
    }
  }

  // ---- CARD (Paystack) ----
  async function onClientPayNow() {
    if (!booking) return;
    if (
      !window.PaystackPop ||
      typeof window.PaystackPop.setup !== "function"
    ) {
      return alert(
        "Paystack library not loaded yet. Please wait a moment or refresh and try again."
      );
    }
    if (!import.meta.env.VITE_PAYSTACK_PUBLIC_KEY) {
      return alert(
        "Missing VITE_PAYSTACK_PUBLIC_KEY in frontend env."
      );
    }

    setBusy(true);
    try {
      // Best-effort email from token
      let email = me?.email || "customer@example.com";
      try {
        const token = localStorage.getItem("token") || "";
        const payloadJwt = JSON.parse(
          atob((token.split(".")[1] || "e30="))
        );
        if (payloadJwt?.email) email = payloadJwt.email;
      } catch {}

      const ref = `BOOKING-${booking._id}`;
      const handler = window.PaystackPop.setup({
        key: String(
          import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || ""
        ),
        email,
        amount: Number(booking.amountKobo || priceKobo), // kobo
        ref,
        metadata: {
          custom_fields: [
            {
              display_name: "Service",
              variable_name: "service",
              value: svcName,
            },
            {
              display_name: "Booking ID",
              variable_name: "bookingId",
              value: booking._id,
            },
          ],
        },
        callback: async function (response) {
          try {
            const v = await verifyPayment({
              bookingId: booking._id,
              reference: response.reference,
            });
            if (v?.ok) {
              const mine =
                (await getMyBookings().catch(() => [])) || [];
              const updated =
                mine.find(
                  (b) =>
                    String(b._id) === String(booking._id)
                ) ||
                {
                  ...booking,
                  paymentStatus: "paid",
                  status:
                    booking.status === "pending_payment"
                      ? "scheduled"
                      : booking.status,
                };
              setBooking(updated);
              alert("Payment successful.");
            } else {
              alert("Payment verification failed.");
            }
          } catch {
            alert("Payment verification error.");
          } finally {
            setBusy(false);
          }
        },
        onClose: function () {
          setBusy(false);
        },
      });

      handler.openIframe();
    } catch {
      setBusy(false);
    }
  }

  // ---- WALLET ----
  async function onClientPayWithWallet() {
    if (!booking) return;
    setBusy(true);
    try {
      // 🔴 If your backend uses a different endpoint, adjust this URL/payload.
      const data = await payBookingWithWallet(booking._id);

      const updated = data?.booking || data || null;
      if (updated) {
        setBooking(updated);
      } else {
        setBooking((b) =>
          b
            ? {
                ...b,
                paymentStatus: "paid",
                status:
                  b.status === "pending_payment"
                    ? "scheduled"
                    : b.status,
              }
            : b
        );
      }
      alert("Wallet payment successful.");
    } catch (e) {
      console.error(
        "wallet pay error:",
        e?.response?.data || e?.message || e
      );
      alert(
        e?.response?.data?.message ||
          e?.response?.data?.error ||
          "Wallet payment failed. Please try again or choose card."
      );
    } finally {
      setBusy(false);
    }
  }

  const showPrivateToPro = useMemo(() => {
    return (
      isProOwner &&
      (booking?.status === "accepted" ||
        booking?.status === "completed")
    );
  }, [isProOwner, booking]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      {loading ? (
        <div className="text-zinc-400">Loading…</div>
      ) : err ? (
        <div className="rounded-lg border border-red-800 bg-red-900/30 text-red-100 px-3 py-2">
          {err}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-semibold">
              Booking Details
            </h1>
            <div className="flex items-center gap-2">
              <Badge
                tone={
                  booking?.paymentStatus === "paid"
                    ? "emerald"
                    : "amber"
                }
              >
                {booking?.paymentStatus || "unpaid"}
              </Badge>
              <Badge tone={statusTone(booking?.status)}>
                {booking?.status}
              </Badge>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 p-4 bg-black/40 mb-4">
            <div className="font-medium mb-1">
              {svcName} • {formatMoney(priceKobo)}
            </div>
            <div className="text-sm text-zinc-400">
              When: {formatWhen(booking?.scheduledFor)}{" "}
              <span className="mx-2">•</span> LGA:{" "}
              {booking?.lga}
            </div>
            {booking?.addressText ? (
              <div className="text-sm text-zinc-500 mt-1">
                Address/landmark: {booking.addressText}
              </div>
            ) : null}
          </div>

          {(isClient || showPrivateToPro) && (
            <div className="rounded-xl border border-zinc-800 p-4 bg-black/30 mb-4">
              <div className="font-medium mb-2">
                Client Contact (private)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-zinc-500">Name</div>
                  <div>{booking?.clientName || "—"}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Phone</div>
                  <div>
                    {booking?.clientContactPrivate?.phone ||
                      "—"}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-zinc-500">
                    Private Address
                  </div>
                  <div className="break-words">
                    {booking?.clientContactPrivate?.address ||
                      "—"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3">
            {canClientPay && (
              <div className="rounded-xl border border-zinc-800 bg-black/30 p-3 space-y-3">
                <div className="text-sm font-medium">
                  Choose payment method
                </div>
                <PaymentMethodPicker
                  amount={priceKobo / 100}
                  value={payMethod}
                  onChange={setPayMethod}
                  methods={["wallet", "card"]}
                  context={{ bookingId: booking?._id }}
                />
                <button
                  onClick={
                    payMethod === "wallet"
                      ? onClientPayWithWallet
                      : onClientPayNow
                  }
                  disabled={
                    busy ||
                    (payMethod === "card" && !paystackReady)
                  }
                  className="rounded-lg bg-gold text-black px-4 py-2 font-semibold disabled:opacity-50"
                >
                  {busy
                    ? "Processing…"
                    : payMethod === "wallet"
                    ? "Pay from Wallet"
                    : "Pay with Card"}
                </button>
                {payMethod === "card" && !paystackReady && (
                  <p className="text-xs text-zinc-500 mt-1">
                    Loading card payment… if it doesn’t
                    appear, refresh the page.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {canAccept && (
                <button
                  onClick={onAccept}
                  disabled={busy}
                  className="rounded-lg border border-emerald-700 text-emerald-300 px-4 py-2 hover:bg-emerald-950/40 disabled:opacity-40"
                >
                  {busy ? "Working…" : "Accept"}
                </button>
              )}

              {canComplete && (
                <button
                  onClick={onComplete}
                  disabled={busy}
                  className="rounded-lg border border-sky-700 text-sky-300 px-4 py-2 hover:bg-sky-950/40 disabled:opacity-40"
                >
                  {busy ? "Working…" : "Mark Completed"}
                </button>
              )}

              {/* Chat / Call button */}
              {booking?._id && (
                <Link
                  to={`/bookings/${booking._id}/chat`}
                  className="px-4 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-900 text-sm"
                >
                  Open Chat / Call
                </Link>
              )}

              <Link
                to={me?.isPro ? "/pro" : "/browse"}
                className="px-4 py-2 rounded-lg border border-zinc-800"
              >
                Back
              </Link>
            </div>
          </div>

          {/* Meta */}
          <div className="mt-6 text-xs text-zinc-500 space-y-1">
            <div>Booking ID: {booking?._id}</div>
            {booking?.paystackReference && (
              <div>
                Paystack Ref: {booking.paystackReference}
              </div>
            )}
            <div>Created: {formatWhen(booking?.createdAt)}</div>
            {booking?.updatedAt && (
              <div>Updated: {formatWhen(booking.updatedAt)}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- UI bits ---------------- */
function Badge({ children, tone = "zinc" }) {
  const tones = {
    zinc: "bg-zinc-900/40 border-zinc-800 text-zinc-200",
    emerald:
      "bg-emerald-900/30 border-emerald-800 text-emerald-200",
    amber: "bg-amber-900/30 border-amber-800 text-amber-200",
    sky: "bg-sky-900/30 border-sky-800 text-sky-200",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
        tones[tone] || tones.zinc
      }`}
    >
      {children}
    </span>
  );
}
function statusTone(s) {
  if (s === "accepted" || s === "completed") return "emerald";
  if (s === "scheduled") return "sky";
  if (s === "cancelled") return "amber";
  return "amber";
}
