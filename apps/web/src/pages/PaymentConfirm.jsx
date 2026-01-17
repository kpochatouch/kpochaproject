// apps/web/src/pages/PaymentConfirm.jsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export default function PaymentConfirm() {
  const nav = useNavigate();
  const [status, setStatus] = useState("Confirming payment…");
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    (async () => {
      const p = new URLSearchParams(window.location.search);
      const state = p.get("state");

      if (!state) {
        setStatus("Missing payment state. Please contact support.");
        return;
      }

      try {
        const { data } = await api.post("/api/payments/confirm", { state });

        if (data?.ok && data?.bookingId) {
          setStatus("✅ Payment confirmed! Redirecting…");
          setTimeout(() => nav(`/bookings/${data.bookingId}`, { replace: true }), 300);
          return;
        }

        setStatus(
          data?.status
            ? `Payment not confirmed yet (status: ${data.status}).`
            : "Payment not confirmed yet."
        );
      } catch (e) {
        const msg = e?.response?.data?.error || e?.message || "confirm_failed";
        if (msg === "session_expired") {
          setStatus("This confirmation link has expired. If you paid, please contact support.");
        } else {
          setStatus("❌ Could not confirm payment. Please try again.");
        }
      }
    })();
  }, [nav]);

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>Payment Confirmation</h1>
      <p style={{ marginBottom: 16 }}>{status}</p>

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
  );
}