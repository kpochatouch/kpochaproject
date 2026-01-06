// apps/web/src/pages/PaymentConfirm.jsx
import { useEffect, useRef, useState } from "react";

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

        // 3) Build API URL (prefer env; fallback to same-origin)
        const base = import.meta.env.VITE_API_BASE_URL || "";
        const url = `${base}/api/payments/verify`;

        // 4) Verify with backend (public in your server; no token required)
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId, reference }),
        });

        // Network / parse guards
        let j = null;
        try { j = await r.json(); } catch { /* ignore */ }

if (!r.ok) {
  setStatus("❌ Verification failed on the server. Please try again or contact support.");
  return;
}

if (j?.ok) {
  setStatus("✅ Payment confirmed! Redirecting…");
  sessionStorage.removeItem("pay_ref");

  // ✅ redirect to booking details
  setTimeout(() => {
  window.location.assign(`/bookings/${bookingId}`);
}, 800);

  return;
} else {
  setStatus("❌ Payment not confirmed yet. If you were charged, please contact support.");
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
