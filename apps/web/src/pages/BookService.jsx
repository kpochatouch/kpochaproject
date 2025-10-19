// Instant Booking (no date/time) with verified, read-only client identity
// Simplified: no Country/State/LGA fields. Uses inline Paystack (auto-loads script) or optional redirect init.

import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

function usePaystackScript() {
  const [ready, setReady] = useState(!!window.PaystackPop);
  useEffect(() => {
    if (window.PaystackPop) { setReady(true); return; }
    const id = "paystack-inline-sdk";
    if (document.getElementById(id)) return; // already loading
    const s = document.createElement("script");
    s.id = id;
    s.src = "https://js.paystack.co/v1/inline.js";
    s.async = true;
    s.onload = () => setReady(!!window.PaystackPop);
    s.onerror = () => setReady(false);
    document.body.appendChild(s);
  }, []);
  return ready;
}

export default function BookService() {
  const { barberId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const [barber, setBarber] = useState(null);
  const [me, setMe] = useState(null);
  const [clientProfile, setClientProfile] = useState(null);

  // service/price
  const [serviceName, setServiceName] = useState("");
  const [amountNaira, setAmountNaira] = useState("");

  // address (auto from GPS; editable)
  const [addressText, setAddressText] = useState("");

  // payment
  const [paymentMethod, setPaymentMethod] = useState("wallet"); // 'wallet' | 'card'

  // GPS
  const [coords, setCoords] = useState(null); // { lat, lng }
  const [detecting, setDetecting] = useState(false);

  // ui
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [softMsg, setSoftMsg] = useState("");
  const okTimer = useRef();

  const lockService = !!search.get("service");
  const digitsOnly = (s = "") => String(s).replace(/\D/g, "");
  function clearMsg(){ setErrorMsg(""); setSoftMsg(""); clearTimeout(okTimer.current); }

  // load paystack script (for inline)
  const paystackReady = usePaystackScript();

  // read-only name/phone (shown, not editable)
  const clientName  = clientProfile?.fullName || me?.displayName || me?.email || "";
  const clientPhone = clientProfile?.phone || me?.identity?.phone || "";

  // load barber + me + profile
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        clearMsg();
        const [barbRes, meRes] = await Promise.all([
          api.get("/api/barbers/" + barberId),
          api.get("/api/me"),
        ]);
        if (!alive) return;
        setBarber(barbRes?.data || null);
        setMe(meRes?.data || null);

        // profile for verified identity
        try {
          const prof = await api.get("/api/profile/client/me");
          if (alive) setClientProfile(prof?.data || null);
        } catch {}

        // prefill service/amount
        const qsService = search.get("service");
        if (qsService) {
          setServiceName(qsService);
        } else {
          const list = Array.isArray(barbRes?.data?.services) ? barbRes.data.services : [];
          const first = list.length
            ? (typeof list[0] === "string" ? { name: list[0] } : list[0])
            : { name: "Haircut", price: 5000 };
          setServiceName(first.name);
          if (typeof first.price !== "undefined") setAmountNaira(first.price);
        }

        // best-effort address from GPS
        tryGeo(true).catch(()=>{});
      } catch (e) {
        console.error(e);
        setErrorMsg("Could not load booking form.");
      }
    })();
    return () => { alive = false; clearTimeout(okTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barberId]);

  // service options
  const serviceOptions = useMemo(() => {
    const list = Array.isArray(barber?.services) ? barber.services : [];
    return list.length ? list : [{ name: "Haircut", price: 5000 }];
  }, [barber]);

  // keep amount synced with selected service (read-only)
  useEffect(() => {
    const list = serviceOptions.map(s => (typeof s === "string" ? { name: s } : s));
    const found = list.find((s) => s.name === serviceName);
    if (found && typeof found.price !== "undefined") setAmountNaira(found.price);
  }, [serviceOptions, serviceName]);

  function formattedAddressFromGeo(p = {}) {
    const parts = [
      p.address_line1,
      p.address_line2,
      [p.street, p.housenumber].filter(Boolean).join(" "),
      p.district || p.suburb,
      p.city || p.county,
      p.state,
      p.country,
    ].filter(Boolean);
    return Array.from(new Set(parts)).join(", ");
  }

  async function tryGeo(auto = false) {
    if (!("geolocation" in navigator)) {
      if (!auto) setErrorMsg("Geolocation not supported on this device/browser.");
      return;
    }
    return new Promise((resolve) => {
      setDetecting(true);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords || {};
          setCoords({ lat, lng });
          try {
            const { data } = await api.get("/api/geo/rev", { params: { lat, lon: lng } });
            const p = data?.features?.[0]?.properties || {};
            const pretty = formattedAddressFromGeo(p);
            if (pretty && !addressText.trim()) setAddressText(pretty);
          } catch {}
          setDetecting(false);
          resolve();
        },
        (err) => {
          console.warn("[geo] getCurrentPosition error:", err?.message || err);
          if (!auto) setErrorMsg("We couldn't get your location. Please allow location access and try again.");
          setDetecting(false);
          resolve();
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  async function checkNearbyAvailability() {
    try {
      setSoftMsg("");
      if (!coords?.lat || !coords?.lng) return true;
      const { data } = await api.get(
        `/api/barbers/nearby?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lng)}&radiusKm=25`
      );
      if (data?.count > 0) return true;
      setSoftMsg("No professional is free in your area right now. We’ll notify you as soon as someone accepts.");
      return false;
    } catch {
      return true; // fail-soft
    }
  }

  async function startPaystackInline(booking) {
    if (!window.PaystackPop || typeof window.PaystackPop.setup !== "function") {
      throw new Error("paystack_inline_missing");
    }
    let email = me?.email || "customer@example.com";
    if (!import.meta.env.VITE_PAYSTACK_PUBLIC_KEY) {
      console.warn("[BookService] Missing VITE_PAYSTACK_PUBLIC_KEY");
    }
    return new Promise((resolve, reject) => {
      const handler = window.PaystackPop.setup({
        key: String(import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || ""),
        email,
        amount: Number(booking.amountKobo), // kobo
        ref: "BOOKING-" + booking._id,
        metadata: {
          custom_fields: [
            { display_name: "Service", variable_name: "service", value: serviceName },
            { display_name: "Pro ID", variable_name: "proId", value: barberId },
            { display_name: "Client Phone", variable_name: "clientPhone", value: digitsOnly(clientPhone) },
            { display_name: "Address", variable_name: "address", value: addressText.trim() },
            coords ? { display_name: "GPS", variable_name: "gps", value: `${coords.lat},${coords.lng}` } : null,
          ].filter(Boolean),
        },
        callback: async (response) => {
          try {
            const verify = await api.post("/api/payments/verify", {
              bookingId: booking._id,
              reference: response.reference,
            });
            if (verify?.data?.ok) {
              navigate(`/bookings/${booking._id}`);
              resolve();
            } else {
              reject(new Error("verify_failed:" + (verify?.data?.status || "unknown")));
            }
          } catch (e) {
            reject(e);
          }
        },
        onClose: () => reject(new Error("payment_cancelled")),
      });
      handler.openIframe();
    });
  }

  async function startPaystackRedirect(booking) {
    // Optional server endpoint (see snippet below).
    // If present, it returns { authorization_url, reference } and we redirect.
    const { data } = await api.post("/api/payments/init", {
      bookingId: booking._id,
      amountKobo: booking.amountKobo,
      email: me?.email || "customer@example.com",
    });
    if (!data?.authorization_url) throw new Error("init_failed");
    window.location.href = data.authorization_url;
  }

  async function instantCheckout() {
    setErrorMsg(""); setSoftMsg("");

    const token = localStorage.getItem("token");
    if (!token) {
      navigate(`/login?next=/book/${barberId}`);
      return;
    }
    if (!clientName || !clientPhone) {
      setErrorMsg("Your verified name/phone are missing. Update them in Settings.");
      return;
    }
    if (!serviceName) return setErrorMsg("Select a service.");
    if (!amountNaira || Number(amountNaira) <= 0) return setErrorMsg("Invalid amount.");
    if (!addressText.trim()) return setErrorMsg("Please add an address/landmark.");

    const ok = await checkNearbyAvailability();
    if (!ok) return;

    const payload = {
      proId: barberId,
      serviceName,
      amountKobo: Math.round(Number(amountNaira) * 100),
      addressText: addressText.trim(),
      client: { name: clientName, phone: digitsOnly(clientPhone) },
      coords,
      paymentMethod,
      instant: true,
    };

    try {
      setLoading(true);
      const { data } = await api.post("/api/bookings/instant", payload);

      const booking = data?.booking || data;
      if (!booking?._id) throw new Error("Booking init failed.");

      if (paymentMethod === "wallet") {
        if (data?.ok === false) {
          setErrorMsg(data?.message || "Wallet payment failed.");
        } else {
          navigate(`/bookings/${booking._id}`);
        }
        setLoading(false);
        return;
      }

      // CARD: Prefer inline; fall back to redirect init if inline SDK unavailable
      try {
        if (!paystackReady) throw new Error("inline_not_ready");
        await startPaystackInline(booking);
      } catch (e) {
        // Try redirect init if backend supports it
        try {
          await startPaystackRedirect(booking);
        } catch {
          setErrorMsg("Paystack checkout couldn’t start. Please refresh and try again.");
        }
      } finally {
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Booking failed."
      );
      setLoading(false);
    }
  }

  if (!barber) {
    return <div className="max-w-3xl mx-auto px-4 py-10">Loading…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h2 className="text-2xl font-semibold mb-2">Instant Book {barber.name}</h2>
      <p className="text-zinc-300 mb-6">
        {barber.lga} • Availability: {barber.availability || "Unknown"}
      </p>

      {(!clientName || !clientPhone) && (
        <div className="mb-4 rounded border border-amber-700 bg-amber-900/30 text-amber-100 px-3 py-2">
          We couldn’t find a verified name/phone for your account. Update them in{" "}
          <Link to="/settings" className="underline">Settings</Link> to continue.
        </div>
      )}

      {softMsg && <p className="text-amber-400 mb-4">{softMsg}</p>}
      {errorMsg && <p className="text-red-400 mb-4 font-semibold">{errorMsg}</p>}

      {/* Service + price (locked) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <label className="block">
          <span className="text-sm text-zinc-400">Service</span>
          <select
            className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            disabled={lockService}
          >
            {serviceOptions.map((s, i) => {
              const item = typeof s === "string" ? { name: s } : s;
              return (
                <option key={item.name || i} value={item.name}>
                  {item.name} {item.price ? `— ₦${Number(item.price).toLocaleString()}` : ""}
                </option>
              );
            })}
          </select>
        </label>

        <label className="block">
          <span className="text-sm text-zinc-400">Amount (₦)</span>
          <input
            type="number"
            min="0"
            className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 opacity-70"
            value={amountNaira}
            readOnly
            disabled
            title="Price set by selected service"
          />
        </label>
      </div>

      {/* Client (read-only) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <label className="block">
          <span className="text-sm text-zinc-400">Your full name</span>
          <input
            className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 opacity-70"
            value={clientName}
            readOnly
            disabled
            title="Verified in Settings"
          />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-400">Phone</span>
          <input
            className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 opacity-70"
            value={clientPhone}
            readOnly
            disabled
            title="Verified in Settings"
          />
        </label>
      </div>

      {/* Address + GPS detect */}
      <div className="grid grid-cols-1 gap-3 mb-4">
        <label className="block">
          <span className="text-sm text-zinc-400">Address / Landmark</span>
          <input
            className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
            value={addressText}
            onChange={(e) => setAddressText(e.target.value)}
            placeholder="Street, estate, landmark…"
          />
        </label>

        <button
          type="button"
          onClick={() => tryGeo(false)}
          className="justify-self-start text-xs px-3 py-1 rounded-lg border border-zinc-700"
        >
          {detecting ? "Detecting…" : coords ? "Re-detect GPS" : "Detect GPS"}
        </button>
        {coords ? (
          <p className="text-xs text-zinc-500">GPS: {coords.lat?.toFixed(5)}, {coords.lng?.toFixed(5)}</p>
        ) : null}
      </div>

      {/* Payment */}
      <div className="mb-4 p-4 rounded-xl border border-zinc-800">
        <p className="text-sm text-zinc-400 mb-2">Payment Method</p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="pay"
              value="wallet"
              checked={paymentMethod === "wallet"}
              onChange={() => setPaymentMethod("wallet")}
            />
            <span>Wallet</span>
          </label>
        </div>
        <div className="flex items-center gap-4 mt-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="pay"
              value="card"
              checked={paymentMethod === "card"}
              onChange={() => setPaymentMethod("card")}
            />
            <span>Saved Card / Card</span>
          </label>
        </div>
        <p className="text-xs text-zinc-500 mt-2">Total: ₦{Number(amountNaira || 0).toLocaleString()}</p>
      </div>

      <button
        type="button"
        onClick={instantCheckout}
        disabled={loading}
        className="rounded-lg bg-gold text-black px-4 py-2 font-semibold disabled:opacity-50"
      >
        {loading ? "Processing…" : "Book Now"}
      </button>
    </div>
  );
}
