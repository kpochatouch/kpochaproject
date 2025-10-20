// apps/web/src/pages/PaymentConfirm.jsx
import { useEffect, useState } from "react";

export default function PaymentConfirm() {
  const [status, setStatus] = useState("Verifying payment…");

  useEffect(() => {
    (async () => {
      try {
        // 1) get saved ref
        const saved = JSON.parse(sessionStorage.getItem("pay_ref") || "{}");
        let { bookingId, reference } = saved;

        // 2) fallback to URL params (Paystack may pass ?reference or ?trxref)
        const p = new URLSearchParams(window.location.search);
        if (!reference) reference = p.get("reference") || p.get("trxref");

        if (!bookingId || !reference) {
          setStatus("Missing booking reference. If you paid, contact support.");
          return;
        }

        const r = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/payments/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // If your /verify is public, remove Authorization. If protected, include token:
            Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
          },
          body: JSON.stringify({ bookingId, reference }),
        });
        const j = await r.json();

        if (j?.ok) {
          setStatus("✅ Payment confirmed! Your booking is now paid.");
          // (Optional) clear saved ref and navigate user
          sessionStorage.removeItem("pay_ref");
          // window.location.assign("/bookings"); // or wherever
        } else {
          setStatus("❌ Payment not confirmed yet. If you were charged, please contact support.");
        }
      } catch (e) {
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
