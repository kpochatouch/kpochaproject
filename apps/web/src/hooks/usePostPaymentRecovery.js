// apps/web/src/hooks/usePostPaymentRecovery.js
import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";

// When user returns to the PWA after a gateway redirect,
// jump them straight to the most recently confirmed booking.
export default function usePostPaymentRecovery(me) {
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    if (!me?.uid) return;

    let alive = true;

    async function check() {
      try {
        const lastSeen = localStorage.getItem("lastPaidBookingId") || "";
        const { data } = await api.get("/api/payments/last-success");
        if (!alive) return;

        const bookingId = data?.bookingId ? String(data.bookingId) : "";
        if (!bookingId) return;

        // Prevent looping if already on that booking
        if (loc.pathname === `/bookings/${bookingId}`) {
          localStorage.setItem("lastPaidBookingId", bookingId);
          return;
        }

        // Only redirect if this is a new confirmed booking we haven't handled
        if (bookingId !== lastSeen) {
          localStorage.setItem("lastPaidBookingId", bookingId);
          nav(`/bookings/${bookingId}`, { replace: true });
        }
      } catch {
        // best-effort: ignore
      }
    }

    // 1) Run once on app open
    check();

    // 2) Run again when app becomes visible / focused (user switched back from browser)
    const onVis = () => {
      if (document.visibilityState === "visible") check();
    };
    const onFocus = () => check();

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [me?.uid, nav, loc.pathname]);
}
