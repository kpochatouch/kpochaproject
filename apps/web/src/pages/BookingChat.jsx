// apps/web/src/pages/BookingChat.jsx
import { useParams, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { api, connectSocket, initiateCall } from "../lib/api";
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
  const location = useLocation();

  // ?call=audio | ?call=video | null
  const startCallType = useMemo(
    () => new URLSearchParams(location.search).get("call"),
    [location.search]
  );

  const { me } = useMe();


  // 🔐 who am I?
  const myUid =
    me?.uid || me?.ownerUid || me?._id || me?.id || me?.userId || null;

  const myLabel =
    me?.displayName || me?.fullName || me?.email || myUid || "me";

  // 🔔 call state for this page (caller only)
  const [callState, setCallState] = useState({
    open: false,
    room: null,
    callId: null,
    callType: "audio",
    role: "caller",
  });

  const [booking, setBooking] = useState(null);
  const [loadingBooking, setLoadingBooking] = useState(true);

  // booking chat room id (for messages)
  const room = useMemo(
    () => (bookingId ? `booking:${bookingId}` : null),
    [bookingId]
  );

  // ---- Load booking meta (for badge + figuring out peerUid) ----
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

  // 🔎 figure out who the *other* person is for this booking
  const peerUid = useMemo(() => {
    if (!booking || !myUid) return null;

    const clientUid =
      booking.clientUid ||
      booking.client_uid ||
      booking.client?.uid ||
      booking.client?.ownerUid ||
      null;

    const proUid =
      booking.proOwnerUid ||
      booking.proUid ||
      booking.pro_uid ||
      booking.pro?.ownerUid ||
      booking.pro?.uid ||
      null;

    // If I'm the client → call the pro
    if (myUid && clientUid && myUid === clientUid) return proUid || null;

    // If I'm the pro → call the client
    if (myUid && proUid && myUid === proUid) return clientUid || null;

    // Fallback (if we can't tell) – just pick "the other" that isn't me
    if (clientUid && clientUid !== myUid) return clientUid;
    if (proUid && proUid !== myUid) return proUid;

    return null;
  }, [booking, myUid]);

  // ---- Socket connection (shared with chat + call status) ----
  const socket = useMemo(() => {
    if (!room) return null;
    try {
      const s = connectSocket();

      // join the booking room on connect (for chat)
      s.emit("join:booking", { bookingId, who: myLabel });

      // after join, mark the booking chat as read
      // (chat:read uses socket.data.room if room isn't passed)
      s.emit("chat:read", {}, (ack) => {
        console.log("booking chat:read ack =", ack);
      });

      return s;
    } catch {
      return null;
    }
  }, [room, bookingId, myLabel]);

  // Clean up socket on unmount
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

  // Listen only for call status → so caller's sheet closes properly
  useEffect(() => {
    if (!socket) return;

    function handleCallStatus(evt) {
      if (!evt) return;
      const { callId, room: callRoom, status } = evt;

      setCallState((prev) => {
        if (!prev.open) return prev;

        // Check if this status belongs to the current call
        if (
          (prev.callId && callId && prev.callId !== callId) ||
          (prev.room && callRoom && prev.room !== callRoom)
        ) {
          return prev;
        }

        if (
          ["ended", "cancelled", "declined", "missed", "failed"].includes(
            status
          )
        ) {
          return { ...prev, open: false };
        }

        return prev;
      });
    }

    try {
      socket.on("call:status", handleCallStatus);
    } catch (e) {
      console.warn(
        "[BookingChat] attach call status listener failed:",
        e?.message || e
      );
    }

    return () => {
      try {
        socket.off("call:status", handleCallStatus);
      } catch {}
    };
  }, [socket]);

    // 🔥 Auto-start call when URL has ?call=audio or ?call=video
  useEffect(() => {
    if (!startCallType) return; // no call param → do nothing
    if (!peerUid) return;       // no peer to call yet
    if (!room) return;          // booking chat room not ready yet
    if (!myUid || !me) return;  // user not ready

    const id = setTimeout(() => {
      handleStartCall(startCallType);
    }, 300);

    return () => clearTimeout(id);
  }, [startCallType, peerUid, room, myUid, me]);

  // ---- Start a call through backend (like DM) ----
  async function handleStartCall(nextType = "audio") {
    if (!booking || !myUid) {
      alert("Booking not ready yet. Please wait a moment and try again.");
      return;
    }

    if (!peerUid) {
      alert("Could not determine who to call for this booking.");
      return;
    }

    // build meta so receiver sees real caller + booking info
    const fromAvatar =
      me?.avatarUrl || me?.photoUrl || me?.photoURL || "";

    const meta = {
      fromUid: myUid,
      fromName: myLabel,
      fromAvatar,
      peerUid,
      bookingId,
      chatRoom: room || null, // booking chat room id
      source: "booking_chat",
    };

    try {
      const ack = await initiateCall({
        receiverUid: peerUid,
        callType: nextType, // "audio" or "video"
        meta,
      });

      const callRoom = ack.room;
      const callId = ack.callId || null;

      if (!callRoom) {
        console.warn("[BookingChat] initiateCall returned no room:", ack);
        alert("Could not start call.");
        return;
      }

      // Outgoing call → we are the caller
      setCallState({
        open: true,
        room: callRoom,
        callId,
        callType: ack.callType || nextType,
        role: "caller",
      });
    } catch (e) {
      console.error("[BookingChat] start call failed:", e);
      alert("Could not start call. Please try again.");
    }
  }

  // ---- Guards ----
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
        <div className="flex items-center gap-2">
          {/* Voice / audio call */}
          <button
            onClick={() => handleStartCall("audio")}
            className="px-4 py-2 rounded-lg bg-gold text-black font-semibold text-sm"
            type="button"
          >
            Voice Call
          </button>

          {/* Video call */}
          <button
            onClick={() => handleStartCall("video")}
            className="px-4 py-2 rounded-lg border border-gold text-gold font-semibold text-sm"
            type="button"
          >
            Video Call
          </button>
        </div>
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
      <ChatPane
        socket={socket}
        room={room}
        meUid={myUid}
        myLabel={myLabel}
        // booking chat is usually between exactly two people,
        // but we don’t have the other profile wired here yet.
        peerUid={peerUid || null}
        initialMessages={[]}
      />

      {/* CallSheet uses the callState (signaling room) + booking chat as chatRoom */}
      <CallSheet
        role={callState.role}
        room={callState.room}
        callId={callState.callId}
        callType={callState.callType}
        me={myLabel}
        // we don’t know a nice peerName/avatar from booking here yet,
        // so we leave them empty and let CallSheet fall back.
        peerName=""
        peerAvatar=""
        chatRoom={room}
        open={callState.open}
        onClose={() =>
          setCallState((prev) => ({
            ...prev,
            open: false,
          }))
        }
      />
    </div>
  );
}
