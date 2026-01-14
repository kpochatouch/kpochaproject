// apps/web/src/pages/BookService.jsx
// Ultra-simple booking → pay → done.
// Assumes: user is logged in, client register done, service + price came from Browse.

import { useParams, useLocation, useNavigate, Link } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { api } from "../lib/api";
import { getAuth, onAuthStateChanged } from "firebase/auth";

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

// helper: get firebase id token, waiting briefly if auth not yet ready
async function getIdTokenOrNull(timeoutMs = 5000) {
  try {
    const auth = getAuth();
    if (auth?.currentUser) {
      try {
        return await auth.currentUser.getIdToken(false);
      } catch {
        // fall through to onAuthStateChanged below
      }
    }

    return await new Promise((resolve) => {
      let done = false;
      let unsub = () => {};
      try {
        unsub = onAuthStateChanged(auth, async (user) => {
          if (done) return;
          done = true;
          try {
            unsub();
          } catch {}
          if (!user) return resolve(null);
          try {
            const t = await user.getIdToken(false);
            resolve(t);
          } catch {
            resolve(null);
          }
        });
      } catch (e) {
        // if onAuthStateChanged fails, resolve null after timeout
      }
      setTimeout(() => {
        if (!done) {
          done = true;
          try {
            unsub();
          } catch {}
          resolve(null);
        }
      }, timeoutMs);
    });
  } catch (e) {
    console.warn("getIdTokenOrNull error:", e);
    return null;
  }
}

export default function BookService() {
  const { barberId } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const paystackReady = usePaystackReady();

  // carried from Browse / BarberCard
  const carry = location.state || {};
  const carriedService = carry.serviceName || "";
  const carriedAmount =
    typeof carry.amountNaira !== "undefined" ? carry.amountNaira : "";
  const carriedState = (carry.state || "").toString().toUpperCase();
  const carriedLga = (carry.lga || "").toString().toUpperCase();

  const [barber, setBarber] = useState(null);
  const [me, setMe] = useState(null);
  const [client, setClient] = useState(null);

  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState(null);

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // load pro + me + client-profile — wait for Firebase auth before calling protected endpoints
  useEffect(() => {
    let alive = true;
    let unsub = null;

    async function fetchPublicBarber() {
      try {
        const proRes = await api.get(`/api/barbers/${barberId}`);
        if (!alive) return;
        setBarber(proRes.data || null);
      } catch (e) {
        // public barber fetch failed but keep going — it may be recovered by re-render
        console.error("[book] fetchPublicBarber error:", e);
        if (alive) setBarber(null);
      }
    }

    async function fetchProtected(token) {
      try {
        // prepare headers (axios-style config)
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        // fetch me (protected) and profile (protected)
        const meRes = await api.get("/api/me", { headers });
        if (!alive) return;
        setMe(meRes.data || null);

        // client profile
        try {
          const profRes = await api.get("/api/profile/client/me", { headers });
          if (alive) {
            setClient(profRes.data || null);
            setAddress((profRes.data && profRes.data.address) || "");
          }
        } catch (innerErr) {
          // client profile may be absent for some users — that's okay
          console.info(
            "[book] no client profile (ok)",
            innerErr?.response?.data || innerErr?.message || innerErr,
          );
        }

        // best-effort GPS → to help the pro
        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (!alive) return;
              const { latitude: lat, longitude } = pos.coords || {};
              // use `lng` name to match server expectation (and avoid NaN casts)
              const lng =
                typeof longitude !== "undefined"
                  ? Number(longitude)
                  : undefined;
              const latNum =
                typeof lat !== "undefined" ? Number(lat) : undefined;
              if (Number.isFinite(latNum) && Number.isFinite(lng)) {
                setCoords({ lat: latNum, lng });
              } else {
                // fallback to leaving coords null if we couldn't get usable numbers
                setCoords(null);
              }
            },
            () => {},
            { enableHighAccuracy: true, timeout: 10000 },
          );
        }
      } catch (err) {
        console.error(
          "[book] protected fetch error:",
          err?.response?.data || err?.message || err,
        );
        if (alive) setErr("Could not load booking.");
      }
    }

    // public barber immediate fetch (no token required)
    fetchPublicBarber();

    // wait for firebase auth to settle (handle both signed-in and signed-out states)
    try {
      const auth = getAuth();
      unsub = onAuthStateChanged(auth, async (user) => {
        // onAuthStateChanged fires immediately with the current state (including null).
        // If user exists, get token and call protected endpoints.
        if (!alive) return;
        if (user) {
          try {
            const token = await user.getIdToken(false);
            await fetchProtected(token);
          } catch (e) {
            console.error("[book] token/fetchProtected error:", e);
            if (alive) setErr("Could not load booking.");
          }
        } else {
          // user is signed out — attempt protected fetch without token (backend will 401 if required)
          // this allows public browsing if you ever make /api/me optional; otherwise user will be prompted to login when booking.
          await fetchProtected(null);
        }
      });
    } catch (e) {
      console.error("[book] onAuthStateChanged setup failed:", e);
      // fallback: try to fetch protected without token (will likely yield 401)
      fetchProtected(null);
    }

    return () => {
      alive = false;
      clearTimeout(okTimer.current);
      if (typeof unsub === "function") unsub();
    };
  }, [barberId]);

  // If no carriedService, fall back to the first service from backend
  const fallbackServiceName =
    carriedService ||
    (Array.isArray(barber?.services) && barber.services.length
      ? typeof barber.services[0] === "string"
        ? barber.services[0] // string style
        : barber.services[0]?.name || "" // object style { name, price }
      : "");

  const serviceName = fallbackServiceName;

  // Amount: use carriedAmount if present, otherwise price of that first service
  const amountNaira =
    carriedAmount !== "" &&
    carriedAmount !== null &&
    typeof carriedAmount !== "undefined"
      ? Number(carriedAmount)
      : Array.isArray(barber?.services) && barber.services.length
        ? Number(
            typeof barber.services[0] === "string"
              ? 0
              : barber.services[0]?.price || 0,
          )
        : 0;

  async function startPaystackInline(booking, idToken = null) {
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
            {
              display_name: "Service",
              variable_name: "service",
              value: serviceName,
            },
            {
              display_name: "Address",
              variable_name: "address",
              value: address.trim(),
            },
            coords
              ? {
                  display_name: "GPS",
                  variable_name: "gps",
                  value: `${coords.lat},${coords.lng}`,
                }
              : null,
          ].filter(Boolean),
        },

        // NOTE: plain function; async work inside
        callback: function (res) {
          (async () => {
            try {
              const headers = idToken
                ? { Authorization: `Bearer ${idToken}` }
                : {};

              // optional: verify immediately
              await api.post(
                "/api/payments/verify",
                { bookingId: booking._id, reference: res.reference },
                { headers },
              );

              // save info for PaymentConfirm.jsx
              sessionStorage.setItem(
                "pay_ref",
                JSON.stringify({
                  bookingId: booking._id,
                  reference: res.reference,
                }),
              );

              // go to payment confirm page (not booking details)
              nav(
                `/payment/confirm?bookingId=${booking._id}&reference=${encodeURIComponent(
                  res.reference,
                )}`,
              );

              resolve();
            } catch (e) {
              console.error(
                "verify payment error:",
                e?.response?.data || e?.message || e,
              );
              reject(e);
            }
          })();
        },

        onClose: function () {
          reject(new Error("pay_cancelled"));
        },
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
      setErr(
        "Update your client profile (name + phone + address) before booking.",
      );
      return;
    }
    if (!serviceName) {
      setErr("No service selected.");
      return;
    }

    // compute amount in kobo and validate
    const amountNairaNum = Number(amountNaira || 0);
    if (!Number.isFinite(amountNairaNum) || amountNairaNum <= 0) {
      setErr("Invalid price for this service.");
      return;
    }
    const amountKobo = Math.round(amountNairaNum * 100);
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
      setErr("Invalid price for this service.");
      return;
    }

    if (!address.trim()) {
      setErr("Please confirm or edit your address/landmark.");
      return;
    }

    // NORMALIZE COORDS -> ensure we send numeric { lat, lng } or null
    const normalizedCoords =
      coords &&
      typeof coords === "object" &&
      (coords.lat != null || coords.latitude != null)
        ? (() => {
            const latRaw = coords.lat ?? coords.latitude;
            // accept either lon or lng or longitude
            const lngRaw = coords.lng ?? coords.lon ?? coords.longitude;
            const latNum = Number(latRaw);
            const lngNum = Number(lngRaw);
            // only send coords when both are valid numbers
            if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
              return { lat: latNum, lng: lngNum };
            }
            return null;
          })()
        : null;

    const payload = {
      proId: barberId,
      serviceName,
      amountKobo,
      addressText: address.trim(),

      // ✅ match backend fields (/bookings/instant expects these)
      clientName: client.fullName,
      clientPhone: client.phone,

      country: "Nigeria",
      state: carriedState || client.state || "",
      lga: carriedLga || client.lga || "",
      coords: normalizedCoords,

      // backend uses paymentMethodRequested in meta
    };

    try {
      setBusy(true);

      // 1) Availability check (only if we have coords)
      if (normalizedCoords) {
        try {
          const { data: avail } = await api.post("/api/availability/check", {
            lat: normalizedCoords.lat,
            lng: normalizedCoords.lng,
          });

          if (!avail?.ok) {
            if (avail?.reason === "NO_PRO_AVAILABLE") {
              setErr(
                "No professional is currently available around this location.",
              );
            } else {
              setErr(
                "Could not confirm availability. Please try again in a moment.",
              );
            }
            return; // stop here, do not create booking
          }

          // Optionally: you can show ETA somewhere later with avail.etaMins
          // e.g., "Pro can arrive in about 10 minutes"
        } catch (e) {
          console.error(
            "[availability] check failed:",
            e?.response?.data || e?.message || e,
          );
          // Fail-soft: you can either block or allow booking when availability fails.
          // I'll allow booking but you can choose to block if you prefer.
          // setErr("We couldn't confirm availability right now. Please try again.");
          // return;
        }
      }

      // 2) Get ID token (if any) and attach to headers
      const idToken = await getIdTokenOrNull();
      const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};

      // 3) Create booking (protected route)
      const { data } = await api.post("/api/bookings/instant", payload, {
        headers,
      });
      const booking = data?.booking || data;
      if (!booking?._id) {
        console.error("booking create response:", data);
        throw new Error("booking_init_failed");
      }

      // 4) Payment happens on BookingDetails (wallet OR card)
      // This keeps the flow simple and avoids duplicate Paystack logic.
      nav(`/bookings/${booking._id}`);
      return;
    } catch (e) {
      console.error("handleBook error:", e?.response?.data || e?.message || e);
      const serverMsg = e?.response?.data?.error || e?.response?.data?.message;
      setErr(serverMsg || "Booking failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-2">Confirm &amp; Pay</h1>
      <p className="text-zinc-400 mb-6">
        You&apos;re booking{" "}
        <span className="text-gold font-medium">
          {barber?.name || "Professional"}
        </span>
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
            {carriedState || client?.state || "—"} •{" "}
            {carriedLga || client?.lga || "—"}
          </span>
        </div>
      </div>

      {/* address (only editable part) */}
      <label className="block mb-6">
        <div className="text-sm text-zinc-300 mb-1">
          Address / Landmark (edit for this booking)
        </div>
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
