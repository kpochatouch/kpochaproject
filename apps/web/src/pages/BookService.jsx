// apps/web/src/pages/BookService.jsx
// Ultra-simple booking → pay → done.
// Assumes: user is logged in, client register done, service + price came from Browse.

import { useParams, useLocation, useNavigate, Link } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { api } from "../lib/api";

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

export default function BookService() {
  const { barberId } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const paystackReady = usePaystackReady();

  // carried from Browse / BarberCard
  const carry = location.state || {};
  const carriedService = carry.serviceName || "";
  const carriedAmount = typeof carry.amountNaira !== "undefined" ? carry.amountNaira : "";
  const carriedState = (carry.state || "").toString().toUpperCase();
  const carriedLga = (carry.lga || "").toString().toUpperCase();

  const [barber, setBarber] = useState(null);
  const [me, setMe] = useState(null);
  const [client, setClient] = useState(null);

  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState(null);

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const okTimer = useRef();

  // load pro + me + client-profile
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [proRes, meRes] = await Promise.all([
          api.get(`/api/barbers/${barberId}`),
          api.get("/api/me"),
        ]);
        if (!alive) return;
        setBarber(proRes.data || null);
        setMe(meRes.data || null);

        // client profile (so we can prefill address)
        try {
          const { data } = await api.get("/api/profile/client/me");
          if (alive) {
            setClient(data || null);
            // prefill address
            setAddress(data?.address || "");
          }
        } catch {
          // no client profile, let it pass — but booking might fail
        }

        // best-effort GPS → to help the pro
        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (!alive) return;
              const { latitude: lat, longitude: lon } = pos.coords || {};
              setCoords({ lat, lon });
            },
            () => {},
            { enableHighAccuracy: true, timeout: 10000 }
          );
        }
      } catch (e) {
        setErr("Could not load booking.");
      }
    })();
    return () => {
      alive = false;
      clearTimeout(okTimer.current);
    };
  }, [barberId]);

  const serviceName = carriedService || "Selected service";
  const amountNaira =
    carriedAmount !== "" ? Number(carriedAmount) : Number(barber?.services?.[0]?.price || 0);

  async function startPaystackInline(booking) {
    if (!window.PaystackPop || typeof window.PaystackPop.setup !== "function") {
      throw new Error("paystack_not_ready");
    }
    const email = me?.email || "customer@example.com";
    return new Promise((resolve, reject) => {
      const handler = window.PaystackPop.setup({
        key: String(import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || ""),
        email,
        amount: Number(booking.amountKobo),
        ref: "BOOKING-" + booking._id,
        metadata: {
          custom_fields: [
            { display_name: "Service", variable_name: "service", value: serviceName },
            { display_name: "Address", variable_name: "address", value: address.trim() },
            coords
              ? {
                  display_name: "GPS",
                  variable_name: "gps",
                  value: `${coords.lat},${coords.lon}`,
                }
              : null,
          ].filter(Boolean),
        },
        callback: async (res) => {
          try {
            await api.post("/api/payments/verify", {
              bookingId: booking._id,
              reference: res.reference,
            });
            nav(`/bookings/${booking._id}`, { replace: true });
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        onClose: () => reject(new Error("pay_cancelled")),
      });
      handler.openIframe();
    });
  }

  async function startPaystackRedirect(booking) {
    // fallback if inline fails
    const { data } = await api.post("/api/payments/init", {
      bookingId: booking._id,
      amountKobo: booking.amountKobo,
      email: me?.email || "customer@example.com",
    });
    if (!data?.authorization_url) throw new Error("paystack_init_failed");
    window.location.href = data.authorization_url;
  }

  async function handleBook() {
    setErr("");
    if (!me) {
      nav(`/login?next=/book/${barberId}`);
      return;
    }
    if (!client?.fullName || !client?.phone) {
      setErr("Update your client profile (name + phone + address) before booking.");
      return;
    }
    if (!serviceName) {
      setErr("No service selected.");
      return;
    }
    if (!amountNaira || Number(amountNaira) <= 0) {
      setErr("Invalid price for this service.");
      return;
    }
    if (!address.trim()) {
      setErr("Please confirm or edit your address/landmark.");
      return;
    }

    const payload = {
      proId: barberId,
      serviceName,
      amountKobo: Math.round(Number(amountNaira) * 100),
      addressText: address.trim(),
      client: {
        name: client.fullName,
        phone: client.phone,
      },
      country: "Nigeria",
      state: carriedState || client.state || "",
      lga: carriedLga || client.lga || "",
      coords,
      instant: true,
      paymentMethod: "card",
    };

    try {
      setBusy(true);
      const { data } = await api.post("/api/bookings/instant", payload);
      const booking = data?.booking || data;
      if (!booking?._id) throw new Error("booking_init_failed");

      // go to paystack
      try {
        if (paystackReady) {
          await startPaystackInline(booking);
        } else {
          await startPaystackRedirect(booking);
        }
      } catch (e) {
        console.error(e);
        setErr("Payment could not start. Open the booking detail to pay again.");
        nav(`/bookings/${booking._id}`);
      }
    } catch (e) {
      setErr(
        e?.response?.data?.error ||
          e?.response?.data?.message ||
          "Booking failed. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-2">Confirm &amp; Pay</h1>
      <p className="text-zinc-400 mb-6">
        You&apos;re booking{" "}
        <span className="text-gold font-medium">{barber?.name || "Professional"}</span>
      </p>

      {err && (
        <div className="mb-4 rounded border border-red-800 bg-red-900/30 text-red-100 px-3 py-2">
          {err}
        </div>
      )}

      {/* service summary */}
      <div className="mb-4 rounded-xl border border-zinc-800 bg-black/40 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">Service</span>
          <span className="font-medium">{serviceName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">Amount</span>
          <span className="font-semibold text-gold">
            ₦{Number(amountNaira || 0).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">Area</span>
          <span>
            {carriedState || client?.state || "—"} • {carriedLga || client?.lga || "—"}
          </span>
        </div>
      </div>

      {/* address (only editable part) */}
      <label className="block mb-6">
        <div className="text-sm text-zinc-300 mb-1">Address / Landmark (edit for this booking)</div>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          placeholder="Street, estate, hotel, event centre…"
        />
      </label>

      <button
        onClick={handleBook}
        disabled={busy}
        className="w-full sm:w-auto px-6 py-3 rounded-lg bg-gold text-black font-semibold disabled:opacity-50"
      >
        {busy ? "Processing…" : "Pay & Book now"}
      </button>

      <p className="text-xs text-zinc-500 mt-4">
        By booking you agree to our{" "}
        <Link to="/legal#terms" className="text-gold underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link to="/legal#privacy" className="text-gold underline">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
