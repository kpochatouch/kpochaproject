// apps/web/src/pages/PaymentConfirm.jsx
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export default function PaymentConfirm() {
  const [status, setStatus] = useState("Verifying payment…");
  const [details, setDetails] = useState({ bookingId: null, reference: null });
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    (async () => {
      try {
        // 1) Read saved values from sessionStorage (set before redirect)
        const saved = JSON.parse(sessionStorage.getItem("pay_ref") || "{}");
        let { bookingId, reference } = saved;

        // 2) Fallbacks from URL (Paystack returns ?reference or ?trxref; we may also pass ?bookingId)
        const p = new URLSearchParams(window.location.search);
        if (!reference) reference = p.get("reference") || p.get("trxref");
        if (!bookingId) bookingId = p.get("bookingId") || null;

        // Keep small summary on screen
        setDetails({ bookingId, reference });

        if (!bookingId || !reference) {
          setStatus("Missing booking reference. If you paid, please contact support.");
          return;
        }

        try {
        const { data: j } = await api.post("/api/payments/verify", {
          bookingId,
          reference,
        });

        if (j?.ok) {
          setStatus("✅ Payment confirmed! Redirecting…");
          sessionStorage.removeItem("pay_ref");

          setTimeout(() => {
            window.location.assign(`/bookings/${bookingId}`);
          }, 800);

          return;
        }

        setStatus("❌ Payment not confirmed yet. If you were charged, please contact support.");
      } catch (e) {
        const code = e?.response?.status;
        const msg = e?.response?.data?.error || e?.response?.data?.message;

        if (code === 401) {
          setStatus("🔒 You are not logged in. Please login again, then return to verify payment.");
        } else if (code === 403 && msg === "not_your_booking") {
          setStatus("❌ This booking does not belong to you.");
        } else if (msg === "reference_mismatch") {
          setStatus("❌ Payment reference mismatch. Please contact support.");
        } else {
          setStatus("❌ Could not verify payment. Please try again or contact support.");
        }
      }

      } catch {
        setStatus("❌ Could not verify payment. Please try again or contact support.");
      }
    })();
  }, []);

  // Helper to lightly mask long refs on screen
  const shortRef = details.reference
    ? String(details.reference).length > 10
      ? `${String(details.reference).slice(0, 4)}…${String(details.reference).slice(-4)}`
      : details.reference
    : null;

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>Payment Confirmation</h1>
      <p style={{ marginBottom: 16 }}>{status}</p>

      {(details.bookingId || details.reference) && (
        <div
          style={{
            border: "1px solid #333",
            borderRadius: 8,
            padding: 12,
            marginTop: 8,
            fontFamily: "monospace",
            fontSize: 14,
          }}
        >
          {details.bookingId && <div>bookingId: {details.bookingId}</div>}
          {details.reference && <div>reference: {shortRef}</div>}
        </div>
      )}

<div style={{ marginTop: 20 }}>
  <button
    onClick={() => window.location.reload()}
    style={{
      padding: "10px 14px",
      background: "#222",
      color: "#fff",
      borderRadius: 8,
      border: "1px solid #333",
      cursor: "pointer",
    }}
  >
    Try Again
  </button>
</div>
 </div>
  );
}
