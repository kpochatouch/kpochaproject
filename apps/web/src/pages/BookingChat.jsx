// apps/web/src/pages/BookingChat.jsx
import { useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { api, connectSocket } from "../lib/api";
import { useMe } from "../context/MeContext.jsx";
import ChatPane from "../components/ChatPane";
import CallSheet from "../components/CallSheet";

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

export default function BookingChat() {
  const { bookingId } = useParams();
  const { me } = useMe();
  const [openCall, setOpenCall] = useState(false);

  const [booking, setBooking] = useState(null);
  const [loadingBooking, setLoadingBooking] = useState(true);

  const room = useMemo(
    () => (bookingId ? `booking:${bookingId}` : null),
    [bookingId]
  );

  const myLabel =
    me?.displayName || me?.fullName || me?.email || me?.uid || "me";

  // ---- Load booking meta (for badge) ----
  useEffect(() => {
    if (!bookingId) {
      setLoadingBooking(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        setLoadingBooking(true);
        const { data } = await api.get(
          `/api/bookings/${encodeURIComponent(bookingId)}`
        );
        if (!alive) return;
        setBooking(data || null);
      } catch {
        if (alive) setBooking(null);
      } finally {
        if (alive) setLoadingBooking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookingId]);

  const svcName = useMemo(
    () =>
      booking?.service?.serviceName ||
      booking?.serviceName ||
      "Selected service",
    [booking]
  );

  const priceText = useMemo(() => {
    const kobo = Number.isFinite(Number(booking?.amountKobo))
      ? Number(booking.amountKobo)
      : Number(booking?.service?.priceKobo) || 0;
    if (!kobo) return "";
    return formatMoney(kobo);
  }, [booking]);

  const areaText = useMemo(
    () => booking?.lga || booking?.state || "",
    [booking]
  );

  // ---- Socket connection (shared with chat + call) ----
  const socket = useMemo(() => {
    if (!room) return null;
    try {
      const s = connectSocket();
      // join the booking room on connect
      s.emit("join:booking", { bookingId, who: myLabel });
      return s;
    } catch {
      return null;
    }
  }, [room, bookingId, myLabel]);

  useEffect(() => {
    return () => {
      try {
        if (socket && room) {
          socket.emit("room:leave", { room });
        }
        socket?.disconnect();
      } catch {}
    };
  }, [socket, room]);

  if (!room) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <p>Missing booking id.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Booking Chat</h1>
          <p className="text-xs text-zinc-500">
            Chat and voice call for this booking.
          </p>
        </div>
        <button
          onClick={() => setOpenCall(true)}
          className="px-4 py-2 rounded-lg bg-gold text-black font-semibold"
        >
          Start Call
        </button>
      </div>

      {/* Badge: what this chat is about */}
      {!loadingBooking && booking && (
        <div className="rounded-lg border border-zinc-800 bg-black/40 px-4 py-3 text-sm flex flex-wrap gap-2 items-center">
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            You&apos;re chatting about:
          </span>
          <span className="font-medium">{svcName}</span>
          {priceText && (
            <span className="text-zinc-400 text-xs md:text-sm">
              • {priceText}
            </span>
          )}
          {areaText && (
            <span className="text-zinc-500 text-xs md:text-sm">
              • {areaText}
            </span>
          )}
        </div>
      )}

      {/* Chat uses the shared socket + booking room */}
      <ChatPane socket={socket} room={room} me={myLabel} />

      {/* CallSheet uses the same booking room for WebRTC signaling */}
      <CallSheet
        room={room}
        me={myLabel}
        open={openCall}
        onClose={() => setOpenCall(false)}
      />
    </div>
  );
}
