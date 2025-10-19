import { useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import EnsureClientProfile from "../components/EnsureClientProfile";
import { useAuth } from "../context/AuthContext";
import ChatPane from "../components/ChatPane";
import CallButton from "../components/CallButton";
import CallSheet from "../components/CallSheet";
import { io } from "socket.io-client";

export default function BookingChat() {
  const { bookingId } = useParams();
  const { user } = useAuth();
  const [openCall, setOpenCall] = useState(false);

  const me = user?.email || "client";
  const baseURL =
    import.meta.env.VITE_SOCKET_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    window.location.origin;

  // Create one socket instance and reuse it
  const socket = useMemo(() => {
    if (!bookingId) return null;
    const s = io(baseURL, { transports: ["websocket"], path: "/socket.io" });

    s.on("connect", () => {
      s.emit("room:join", { room: bookingId, who: me });
    });

    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, baseURL, me]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        socket?.disconnect();
      } catch {}
    };
  }, [socket]);

  if (!bookingId) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <p>Missing booking id.</p>
      </div>
    );
  }

  return (
    <EnsureClientProfile>
      <div className="max-w-4xl mx-auto p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Booking Chat</h1>
          <CallButton onStart={() => setOpenCall(true)} />
        </div>

        {/* Chat uses the shared socket */}
        <ChatPane socket={socket} room={bookingId} me={me} />
      </div>

      {/* CallSheet creates its own PeerConnection; it will use SignalingClient.getIceServers() */}
      <CallSheet room={bookingId} me={me} open={openCall} onClose={() => setOpenCall(false)} />
    </EnsureClientProfile>
  );
}
