// apps/web/src/pages/BookingDetails.jsx

// Shows one booking by :id for BOTH clients and pros.
// - Loads viewer identity (/api/me) to know if they’re a pro
// - Finds the booking from "my bookings" (client) and/or "pro bookings" (pro)
// - Client can pay if unpaid (Wallet OR Paystack inline)
// - Pro can Accept
// - Client OR Pro can mark job Completed (backend records who did it)
// - Client and Pro ONLY see their own phone (no sharing phone numbers)
//   • Both sides can still see names (for trust & safety)
// - Only client + pro see address; pro only after accept/completed
// - Chat/Call is available ONLY after booking is accepted/completed
// - When status === "scheduled" & paymentStatus === "paid":
//   • UI shows “Calling your professional…” with 3-ring timer
//   • Client can cancel now or keep waiting
//   • If cron or auto-timeout cancels/refunds, client is sent back to /browse

import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useMe } from "../context/MeContext.jsx";
import {
  api,
  getMyBookings,
  getProBookings,
  acceptBooking,
  completeBooking,
  verifyPayment,
  initPayment,
  payBookingWithWallet,
  cancelBooking,
  getSettings,
  getClientReviews,
  registerSocketHandler,
  joinBookingRoom,
  getBookingUiLabel,
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
  const [ready, setReady] = useState(
    typeof window !== "undefined" && !!window.PaystackPop
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
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
  const navigate = useNavigate();

  const { me, loading: meLoading } = useMe();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [payMethod, setPayMethod] = useState("wallet"); // "wallet" | "card"
  const paystackReady = usePaystackReady();

  // Ring/calling UX
  const [ringSeconds, setRingSeconds] = useState(null); // from /api/settings
  const [ringElapsed, setRingElapsed] = useState(0); // seconds passed while scheduled
  // (removed) client-side auto-cancel; backend cron owns this

  // ⭐ NEW: client reputation state
  const [clientReputation, setClientReputation] = useState(null);
  const [clientReputationLoading, setClientReputationLoading] = useState(false);
  const [clientReputationErr, setClientReputationErr] = useState("");

  // derived (supports new snapshot + legacy fields)
  const svcName = useMemo(
    () => booking?.service?.serviceName || booking?.serviceName || "Service",
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

  // Load client reputation (pro side only)
  useEffect(() => {
    if (!booking || !isProOwner) return;
    const clientUid = booking.clientUid;
    if (!clientUid) return;

    let alive = true;
    setClientReputationLoading(true);
    setClientReputationErr("");

    (async () => {
      try {
        const items = await getClientReviews(clientUid);
        if (!alive) return;

        const list = Array.isArray(items) ? items : [];
        if (!list.length) {
          setClientReputation({ total: 0, avg: null, last: null });
          return;
        }

        const total = list.length;
        const sum = list.reduce((acc, r) => acc + (Number(r.rating) || 0), 0);
        const avg = total ? sum / total : null;
        const last = list[0];

        setClientReputation({ total, avg, last });
      } catch (e) {
        console.error("load client reputation failed", e);
        if (!alive) return;
        setClientReputationErr("Could not load client reputation.");
      } finally {
        if (alive) setClientReputationLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [booking, isProOwner]);

  const canAccept = useMemo(
    () =>
      isProOwner &&
      booking?.paymentStatus === "paid" &&
      booking?.status === "scheduled",
    [isProOwner, booking]
  );

  // Either client OR pro can complete when status is "accepted"
  const canComplete = useMemo(
    () =>
      !!booking && booking.status === "accepted" && (isClient || isProOwner),
    [booking, isClient, isProOwner]
  );

  const canClientPay = useMemo(
    () =>
      isClient &&
      booking?.paymentStatus !== "paid" &&
      (booking?.status === "pending_payment" ||
        booking?.status === "scheduled"),
    [isClient, booking]
  );

  // Name: safe to show to both parties (no phone exposed)
  const clientDisplayName = useMemo(
    () =>
      booking?.clientName ||
      booking?.client?.name ||
      booking?.clientProfile?.fullName ||
      "",
    [booking]
  );

  // Who can see client contact details card?
  // - Client: sees own phone + address.
  // - Pro: sees ONLY address AFTER accept/completed, NEVER sees phone.
  const showClientContactToViewer = useMemo(() => {
    if (!booking) return false;
    if (isClient) return true;
    if (
      isProOwner &&
      (booking.status === "accepted" || booking.status === "completed")
    ) {
      return true;
    }
    return false;
  }, [booking, isClient, isProOwner]);

  const stage = useMemo(() => {
    if (!booking) return "loading";

    if (booking.paymentStatus === "refunded" || booking.status === "cancelled")
      return "cancelled";

    if (booking.paymentStatus !== "paid") return "pay"; // pay first

    if (booking.status === "scheduled") return "waiting"; // paid, waiting pro

    if (booking.status === "accepted") return "in_progress";

    if (booking.status === "completed") return "done";

    return "waiting";
  }, [booking]);

  // Chat/Call visibility:
  // - Before accept: nobody sees it
  // - After accept/completed: both sides can initiate call/chat
  const showChatButton = useMemo(() => {
    if (!booking) return false;
    if (!isClient && !isProOwner) return false;

    // allow chat/call only during job
    if (booking.status === "accepted") return true;

    // allow short grace window after completion (e.g., 10 mins)
    if (booking.status === "completed") {
      const graceMs = 60 * 60 * 1000; // 1 hour
      const completedAtMs = booking.completedAt
        ? new Date(booking.completedAt).getTime()
        : 0;
      if (!completedAtMs) return false;
      return Date.now() - completedAtMs < graceMs;
    }

    return false;
  }, [booking, isClient, isProOwner]);

  // Pro ID used for review links (client -> pro)
  const proIdForReview = useMemo(() => {
    if (!booking) return null;
    return booking.proId || booking.pro?._id || null;
  }, [booking]);

  // Client ID used for pro -> client review links
  const clientIdForReview = useMemo(() => {
    if (!booking) return null;
    return booking.clientUid || booking.clientId || booking.client?._id || null;
  }, [booking]);

  // Load viewer + booking
  useEffect(() => {
    if (meLoading) return;
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErr("");

        let found = null;

        // 1) Client list
        try {
          const mine = await getMyBookings();
          found =
            (mine || []).find((b) => String(b._id) === String(id)) || found;
        } catch {}

        // 2) Pro list (if pro)
        if (!found && me?.isPro) {
          try {
            const proItems = await getProBookings();
            found =
              (proItems || []).find((b) => String(b._id) === String(id)) ||
              found;
          } catch {}
        }

        // 3) Optional direct GET
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
          setErr("Booking not found or you do not have permission to view it.");
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
  }, [id, me?.isPro]);

  // Load ringTimeoutSeconds from settings once
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const s = await getSettings();
        if (!mounted) return;
        const secs = Number(s?.bookingRules?.ringTimeoutSeconds) || 120;
        setRingSeconds(secs);
      } catch {
        if (!mounted) return;
        setRingSeconds(120); // fallback
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // ✅ Socket: instant update when booking is accepted (no redirect)
  useEffect(() => {
    if (!id || !me?.uid) return;

    // Join booking:<id> room so booking-scoped events reach this page
    joinBookingRoom(id, me.uid).catch(() => {});

    const offAccepted = registerSocketHandler("booking:accepted", async (p) => {
      const bid = String(p?.bookingId || "");
      if (bid !== String(id)) return;

      // 1) instant UI flip (chat button appears immediately)
      setBooking((b) =>
        b
          ? { ...b, status: "accepted", acceptedAt: new Date().toISOString() }
          : b
      );

      setRingElapsed(0);

      // 2) then fetch backend truth (best-effort)
      try {
        const { data: fresh } = await api.get(
          `/api/bookings/${encodeURIComponent(id)}`
        );
        if (fresh) setBooking(fresh);
      } catch {
        // ignore
      }
    });

    return () => offAccepted?.();
  }, [id, me?.uid]);

  // ✅ Socket: instant update when booking is completed
  useEffect(() => {
    if (!id || !me?.uid) return;

    const offCompleted = registerSocketHandler(
      "booking:completed",
      async (p) => {
        const bid = String(p?.bookingId || "");
        if (bid !== String(id)) return;

        // instant UI flip
        setBooking((b) =>
          b
            ? {
                ...b,
                status: "completed",
                completedAt:
                  p?.completedAt || b?.completedAt || new Date().toISOString(),
              }
            : b
        );

        // then fetch backend truth (best-effort)
        try {
          const { data: fresh } = await api.get(
            `/api/bookings/${encodeURIComponent(id)}`
          );
          if (fresh) setBooking(fresh);
        } catch {}
      }
    );

    return () => offCompleted?.();
  }, [id, me?.uid]);

  // Ring timer + auto-refresh while scheduled+paid (so client sees accept instantly)
  useEffect(() => {
    if (!booking || !me) return;
    if (me.uid !== booking.clientUid) return;
    if (booking.paymentStatus !== "paid") return;
    if (booking.status !== "scheduled") return;

    const startedAt = booking.ringingStartedAt
      ? new Date(booking.ringingStartedAt).getTime()
      : Date.now();

    // 1) 1s ring elapsed timer (UI only)
    const ringTimer = setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      setRingElapsed(elapsed);
    }, 1000);

    // 2) Poll booking status every 3s while ringing (stop automatically when accepted)
    const pollTimer = setInterval(async () => {
      try {
        const { data: fresh } = await api.get(
          `/api/bookings/${encodeURIComponent(booking._id)}`
        );
        if (fresh) setBooking(fresh);
      } catch {
        // ignore polling errors (best-effort)
      }
    }, 3000);

    return () => {
      clearInterval(ringTimer);
      clearInterval(pollTimer);
    };
  }, [
    booking?._id,
    booking?.status,
    booking?.paymentStatus,
    me?.uid,
    booking?.clientUid,
  ]);

  // If booking is cancelled/refunded for the client, send them back to browse
  useEffect(() => {
    if (!booking || !me) return;
    const clientIsViewer = me.uid === booking.clientUid;
    if (!clientIsViewer) return;

    if (
      booking.paymentStatus === "refunded" ||
      booking.status === "cancelled"
    ) {
      alert(
        "We’re sorry, this service request has been cancelled.\n\nYou can now choose another professional."
      );
      navigate("/browse", { replace: true });
    }
  }, [booking, me, navigate]);

  async function onAccept() {
    if (!booking) return;
    setBusy(true);
    try {
      const updated = await acceptBooking(booking._id);
      setBooking(updated);
      alert("Booking accepted.");
    } catch {
      alert("Could not accept booking. Ensure payment is 'paid'.");
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

      if (isClient) {
        alert(
          "Thank you for confirming. Please remember to leave a review for your professional."
        );
      } else if (isProOwner) {
        alert(
          "Job marked as completed. You can now leave a review for this client."
        );
      } else {
        alert("Booking completed.");
      }
    } catch {
      alert("Could not complete booking.");
    } finally {
      setBusy(false);
    }
  }

  async function onClientCancelNow() {
    if (!booking) return;
    const sure = window.confirm(
      "Do you want to cancel this booking now? If the pro has not accepted yet, your payment will be refunded according to our rules."
    );
    if (!sure) return;

    setBusy(true);
    try {
      const updated = await cancelBooking(booking._id);
      setBooking(updated);
      // redirect is handled by the cancelled/refunded effect above
    } catch (e) {
      console.error(
        "cancel booking error:",
        e?.response?.data || e?.message || e
      );
      alert("Could not cancel booking. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ---- CARD (Paystack) ----
  async function onClientPayNow() {
    console.log("[BookingDetails] Card pay clicked");

    if (!booking) {
      console.log("[BookingDetails] No booking in state");
      return;
    }

    if (typeof window === "undefined") {
      alert("Payment is only available in the browser.");
      return;
    }

    // 1) Check Paystack SDK
    if (!window.PaystackPop || typeof window.PaystackPop.setup !== "function") {
      alert(
        "Paystack library not loaded yet. Please wait a moment or refresh and try again."
      );
      return;
    }

    // 2) Check public key
    const pubKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
    if (!pubKey) {
      alert("Missing VITE_PAYSTACK_PUBLIC_KEY in frontend env.");
      return;
    }

    console.log("==== DEBUG: PAYSTACK SETUP DATA ====");
    console.log({
      amountKobo: Number(booking.amountKobo || priceKobo),
      bookingId: booking._id,
      email: me?.email,
      svcName,
      paystackReady,
      pubKey,
      windowPaystackPopExists: !!window.PaystackPop,
    });

    setBusy(true);

    try {
      // best-effort email from token
      let email = me?.email || "customer@example.com";
      try {
        const token = localStorage.getItem("token") || "";
        const payloadJwt = JSON.parse(atob(token.split(".")[1] || "e30="));
        if (payloadJwt?.email) email = payloadJwt.email;
      } catch (e) {
        console.warn("JWT decode failed, using fallback email:", e);
      }

      // ✅ Always init first so backend stores the canonical reference
      const init = await initPayment({ bookingId: booking._id, email });
      const ref = init?.reference || `BOOKING-${booking._id}-${Date.now()}`;

      const amountKobo = Number(booking.amountKobo || priceKobo) || 0;

      console.log("DEBUG: About to call PaystackPop.setup()", {
        ref,
        amountKobo,
      });

      const handler = window.PaystackPop.setup({
        key: String(pubKey),
        email,
        amount: amountKobo,
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

        // plain function; async work inside
        callback: function (response) {
          console.log("[Paystack callback]", response);

          (async () => {
            try {
              const v = await verifyPayment({
                bookingId: booking._id,
                reference: response.reference,
              });

              if (v?.ok) {
                // ✅ reload booking from server (single source of truth)
                try {
                  const { data: fresh } = await api.get(
                    `/api/bookings/${encodeURIComponent(booking._id)}`
                  );
                  setBooking(fresh || booking);
                } catch {
                  // fallback if GET fails
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
                alert("Payment successful.");
              } else {
                alert("Payment verification failed.");
              }
            } catch (err) {
              console.error("verifyPayment error:", err);
              alert("Payment verification error.");
            } finally {
              setBusy(false);
            }
          })();
        },

        onClose: function () {
          console.log("[Paystack] popup closed");
          setBusy(false);
        },
      });

      handler.openIframe();
    } catch (err) {
      console.error("[BookingDetails] PaystackPop.setup FAILED:", err);
      setBusy(false);
      alert(
        "Could not start card payment. See console for PaystackPop.setup error."
      );
    }
  }

  // ---- WALLET ----
  async function onClientPayWithWallet() {
    if (!booking) return;
    setBusy(true);
    try {
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
                status: b.status === "pending_payment" ? "scheduled" : b.status,
              }
            : b
        );
      }
      alert("Wallet payment successful.");
    } catch (e) {
      console.error("wallet pay error:", e?.response?.data || e?.message || e);
      alert(
        e?.response?.data?.message ||
          e?.response?.data?.error ||
          "Wallet payment failed. Please try again or choose card."
      );
    } finally {
      setBusy(false);
    }
  }

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
            <h1 className="text-2xl font-semibold">Booking Details</h1>
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(booking?.status, booking?.paymentStatus)}>
                {getBookingUiLabel(booking)}
              </Badge>
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-zinc-800 bg-black/30 p-4">
            <div className="text-sm text-zinc-400">What’s happening</div>

            {stage === "pay" && (
              <div className="mt-1 text-lg font-semibold">
                Please complete payment to continue.
              </div>
            )}

            {stage === "waiting" && (
              <div className="mt-1 text-lg font-semibold">
                Payment confirmed. Waiting for the professional to accept…
              </div>
            )}

            {stage === "in_progress" && (
              <div className="mt-1 text-lg font-semibold">
                Booking accepted. You can now chat or call.
              </div>
            )}

            {stage === "done" && (
              <div className="mt-1 text-lg font-semibold">
                Job completed. Thank you!
              </div>
            )}

            {stage === "cancelled" && (
              <div className="mt-1 text-lg font-semibold">
                This booking was cancelled.
              </div>
            )}

            {/* small technical line (optional but helpful) */}
            <div className="mt-2 text-xs text-zinc-500">
              status: {booking?.status} • payment: {booking?.paymentStatus}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 p-4 bg-black/40 mb-4">
            <div className="font-medium mb-1">
              {svcName} • {formatMoney(priceKobo)}
            </div>
            <div className="text-sm text-zinc-400">
              When: {formatWhen(booking?.scheduledFor)}{" "}
              <span className="mx-2">•</span> LGA: {booking?.lga}
            </div>
            {clientDisplayName && (
              <div className="text-xs text-zinc-400 mt-1">
                Client: {clientDisplayName}
              </div>
            )}
            {booking?.proName && (
              <div className="text-xs text-zinc-400 mt-1">
                Professional: {booking.proName}
              </div>
            )}
            {booking?.addressText ? (
              <div className="text-sm text-zinc-500 mt-1">
                Address/landmark: {booking.addressText}
              </div>
            ) : null}
          </div>

          {/* Client & Pro contact view */}
          {showClientContactToViewer && (
            <div className="rounded-xl border border-zinc-800 p-4 bg-black/30 mb-4">
              <div className="font-medium mb-2">Client Contact (private)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-zinc-500">Name</div>
                  <div>{clientDisplayName || "—"}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Phone</div>
                  <div>
                    {isClient
                      ? booking?.clientContactPrivate?.phone || "—"
                      : "Hidden – use in-app chat/call"}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-zinc-500">Service Address</div>
                  <div className="break-words">
                    {booking?.clientContactPrivate?.address ||
                      booking?.addressText ||
                      "—"}
                  </div>
                </div>
              </div>
              {isClient && (
                <p className="text-xs text-zinc-500 mt-2">
                  Your phone number is kept private. Professionals contact you
                  through in-app chat and calls only.
                </p>
              )}
            </div>
          )}

          {/* Client reputation (only visible to pro) */}
          {isProOwner && (
            <div className="rounded-xl border border-zinc-800 p-4 bg-black/30 mb-4">
              <div className="font-medium mb-2">Client Reputation</div>

              {clientReputationLoading ? (
                <div className="text-sm text-zinc-400">
                  Loading client reputation…
                </div>
              ) : clientReputationErr ? (
                <div className="text-sm text-red-400">
                  {clientReputationErr}
                </div>
              ) : clientReputation && clientReputation.total > 0 ? (
                <>
                  <div className="text-sm text-zinc-200">
                    Average rating:{" "}
                    <span className="font-semibold">
                      {clientReputation.avg.toFixed(1)} / 5
                    </span>{" "}
                    ({clientReputation.total} review
                    {clientReputation.total > 1 ? "s" : ""})
                  </div>
                  {clientReputation.last && (
                    <div className="mt-2 text-xs text-zinc-400">
                      Last review:{" "}
                      <span className="italic">
                        {clientReputation.last.title ||
                          clientReputation.last.comment?.slice(0, 80) ||
                          "No comment text"}
                        {clientReputation.last.comment &&
                        clientReputation.last.comment.length > 80
                          ? "…"
                          : ""}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-zinc-400">
                  No previous reviews recorded for this client yet.
                </div>
              )}

              <p className="mt-2 text-xs text-zinc-500">
                This reputation is based on reviews from other professionals who
                have worked with this client.
              </p>
            </div>
          )}

          {/* CALLING / RINGING PHASE */}
          {stage === "waiting" && (
            <CallingPanel
              booking={booking}
              ringSeconds={ringSeconds}
              ringElapsed={ringElapsed}
              onCancel={isClient ? onClientCancelNow : null}
            />
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3">
            {stage === "pay" && canClientPay && (
              <div className="rounded-xl border border-zinc-800 bg-black/30 p-3 space-y-3">
                <div className="text-sm font-medium">Choose payment method</div>
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
                  disabled={busy || (payMethod === "card" && !paystackReady)}
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
                    Loading card payment… if it doesn’t appear, refresh the
                    page.
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

              {/* Client can leave a review ONLY after completion */}
              {isClient &&
                booking?.status === "completed" &&
                proIdForReview && (
                  <Link
                    to={`/review/${proIdForReview}?bookingId=${booking._id}`}
                    className="px-4 py-2 rounded-lg border border-sky-700 text-sky-300 text-sm hover:bg-sky-950/40"
                  >
                    Leave Review
                  </Link>
                )}

              {/* Pro can review client ONLY after completion */}
              {isProOwner &&
                booking?.status === "completed" &&
                clientIdForReview && (
                  <Link
                    to={`/review-client/${clientIdForReview}?bookingId=${booking._id}`}
                    className="px-4 py-2 rounded-lg border border-amber-700 text-amber-300 text-sm hover:bg-amber-950/40"
                  >
                    Review Client
                  </Link>
                )}

              {/* Support contact (after completion) */}
              {booking?.status === "completed" &&
                me?.uid &&
                (me.uid === booking.clientUid ||
                  me.uid === booking.proOwnerUid) && (
                  <a
                    href={buildSupportMailto({
                      bookingId: booking._id,
                      serviceName: svcName,
                    })}
                    className="px-4 py-2 rounded-lg border border-amber-700 text-amber-300 text-sm hover:bg-amber-950/40"
                  >
                    Contact Support (kpochaout@gmail.com)
                  </a>
                )}

              {/* Chat / Call button – only during accepted OR short grace after completed */}
              {showChatButton && booking?._id && (
                <Link
                  to={`/bookings/${booking._id}/chat`}
                  className="px-4 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-900 text-sm"
                >
                  Open Chat / Call
                </Link>
              )}

              <Link
                to={me?.isPro ? "/pro-dashboard" : "/browse"}
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
              <div>Paystack Ref: {booking.paystackReference}</div>
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
    emerald: "bg-emerald-900/30 border-emerald-800 text-emerald-200",
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

function statusTone(status, paymentStatus) {
  if (paymentStatus === "refunded") return "amber";
  if (status === "completed") return "emerald";
  if (status === "accepted") return "emerald";
  if (status === "scheduled") return paymentStatus === "paid" ? "sky" : "amber";
  if (status === "pending_payment") return "amber";
  if (status === "cancelled") return "amber";
  return "zinc";
}

function Step({ label, active }) {
  return (
    <div
      className={`px-2 py-1 rounded text-xs ${
        active ? "bg-gold text-black" : "bg-zinc-800 text-zinc-500"
      }`}
    >
      {label}
    </div>
  );
}

function Line() {
  return <div className="flex-1 h-px bg-zinc-700" />;
}

function buildSupportMailto({ bookingId, serviceName }) {
  const subject = `Kpocha Touch Support — Booking ${bookingId}`;
  const body = `Hello Kpocha Touch Support,

Booking ID: ${bookingId}
Service: ${serviceName}

Explain your issue here...`;

  return `mailto:kpochaout@gmail.com?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

function CallingPanel({ booking, ringSeconds, ringElapsed, onCancel }) {
  const total = ringSeconds || 120;
  const elapsed = Math.min(ringElapsed || 0, total);
  const progress = total > 0 ? elapsed / total : 0;

  let title = "Calling your professional…";
  let subtitle = "Trying to reach your pro.";

  if (progress >= 1 / 3 && progress < 2 / 3) {
    title = "Still trying to connect…";
    subtitle = "Your request is still ringing on the pro’s side.";
  } else if (progress >= 2 / 3) {
    title = "Last attempt before we cancel…";
    subtitle =
      "If they don’t accept soon, this booking will be cancelled automatically.";
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-black/40 p-4 mb-4 text-center animate-pulse">
      <div className="text-lg font-semibold text-gold">{title}</div>
      <div className="text-sm text-zinc-400 mt-1">{subtitle}</div>

      {/* Simple progress bar */}
      <div className="mt-3 h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gold transition-all"
          style={{
            width: `${Math.min(100, Math.round(progress * 100))}%`,
          }}
        />
      </div>

      {/* Three Ring Dots */}
      <div className="flex justify-center gap-2 mt-3">
        <div className="w-2 h-2 bg-gold rounded-full animate-bounce" />
        <div className="w-2 h-2 bg-gold rounded-full animate-bounce delay-150" />
        <div className="w-2 h-2 bg-gold rounded-full animate-bounce delay-300" />
      </div>

      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-3 inline-flex items-center justify-center px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
        >
          Cancel request and go back
        </button>
      )}

      <div className="mt-2 text-xs text-zinc-500">
        Time elapsed: {elapsed}s / {total}s
      </div>
    </div>
  );
}
