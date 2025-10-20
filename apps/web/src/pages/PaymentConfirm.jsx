import { useEffect, useState } from "react";

export default function PaymentConfirm() {
  const [status, setStatus] = useState("Verifying payment…");

  useEffect(() => {
    (async () => {
      try {
        // 1) Read saved values from sessionStorage (set before redirect)
        const saved = JSON.parse(sessionStorage.getItem("pay_ref") || "{}");
        let { bookingId, reference } = saved;

        // 2) Fallback to URL params (Paystack may return ?reference or ?trxref)
        const p = new URLSearchParams(window.location.search);
        if (!reference) reference = p.get("reference") || p.get("trxref");
        if (!bookingId) bookingId = p.get("bookingId") || null;

        if (!bookingId || !reference) {
          setStatus("Missing booking reference. If you paid, please contact support.");
          return;
        }

        const r = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/payments/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId, reference }),
        });
        const j = await r.json();

        if (j?.ok) {
          setStatus("✅ Payment confirmed! Your booking is now paid.");
          sessionStorage.removeItem("pay_ref");
          // Optionally navigate the user:
          // window.location.assign(`/bookings/${bookingId}`);
        } else {
          setStatus("❌ Payment not confirmed yet. If you were charged, please contact support.");
        }
      } catch {
        setStatus("❌ Could not verify payment. Please try again or contact support.");
      }
    })();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Payment Confirmation</h1>
      <p>{status}</p>
    </div>
  );
}
