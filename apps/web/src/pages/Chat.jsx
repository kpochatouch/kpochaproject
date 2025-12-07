// apps/web/src/pages/Chat.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  connectSocket,
  getChatWith,
  getPublicProfileByUid,
  markThreadRead,
  initiateCall,
} from "../lib/api";
import { useMe } from "../context/MeContext.jsx";
import ChatPane from "../components/ChatPane.jsx";
import CallSheet from "../components/CallSheet.jsx";

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function Chat() {
  const navigate = useNavigate();
  const query = useQuery();
  const { me: currentUser, loading: meLoading } = useMe();

  const [socket, setSocket] = useState(null);
  const [room, setRoom] = useState(null);
  const [initialMessages, setInitialMessages] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [callState, setCallState] = useState({
  open: false,
  room: null,
  callId: null,
  callType: "audio",
});

  const [peerProfile, setPeerProfile] = useState(null);

    async function handleStartCall(callType = "audio") {
  if (!peerUid) return;
  try {
    const ack = await initiateCall({
      receiverUid: peerUid,
      callType,   // "audio" or "video"
      meta: {},
    });

    const callRoom = ack.room;
    const callId = ack.callId || null;

    if (!callRoom) {
      console.warn("[chat] initiateCall returned no room:", ack);
      alert("Could not start call.");
      return;
    }

    setCallState({
      open: true,
      room: callRoom,
      callId,
      callType: ack.callType || callType,  // keep in sync with backend
    });
  } catch (e) {
    console.error("start call failed:", e);
    alert("Could not start call. Please try again.");
  }
}

  function handleCallClose() {
    setCallState((prev) => ({ ...prev, open: false }));
    // later you can also call updateCallStatus({ callId: prev.callId, status: "ended" })
  }


  // who we’re chatting with → /chat?with=<uid>
  const peerUid = query.get("with");

  const myUid =
    currentUser?.uid ||
    currentUser?.ownerUid ||
    currentUser?._id ||
    currentUser?.id ||
    currentUser?.userId ||
    null;

  const myLabel =
    currentUser?.displayName ||
    currentUser?.fullName ||
    currentUser?.username ||
    currentUser?.email ||
    myUid ||
    "me";

  // 1) Load peer profile (to show name + avatar)
  useEffect(() => {
    if (!peerUid) return;
    let alive = true;

    (async () => {
      try {
        const data = await getPublicProfileByUid(peerUid);
        if (!alive) return;

        // data shape: { ok: true, profile, posts: ... }
        const p = data?.profile || data;

        if (p) {
          setPeerProfile({
            displayName:
              p.displayName || p.fullName || p.username || "",
            avatarUrl: p.avatarUrl || p.photoUrl || "",
          });
        } else {
          setPeerProfile(null);
        }
      } catch {
        if (alive) setPeerProfile(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [peerUid]);

  // 2) Load history for this DM (room + messages)
  useEffect(() => {
    if (!peerUid || !currentUser || !myUid) {
      setLoadingHistory(false);
      return;
    }

    let alive = true;

    (async () => {
      try {
        setLoadingHistory(true);

        // uses /api/chat/with/:peerUid under the hood
        const data = await getChatWith(peerUid);

        if (!alive) return;

        const roomFromApi = data?.room || null;
        const rawItems = Array.isArray(data?.items) ? data.items : [];

        const normalized = rawItems.map((m) => {
          const fromUid = m.fromUid || m.from || null;
          return {
            room: m.room,
            body: m.body || "",
            fromUid,
            sender: m.sender || null, // server-provided sender object { uid, displayName, photoUrl }
            clientId: m.clientId || null,
            at: m.createdAt || m.at || Date.now(),
            meta: {
              ...(m.meta || {}),
              attachments: m.attachments || [],
            },
            isMe: Boolean(fromUid && myUid && fromUid === myUid),
            seenBy: Array.isArray(m.seenBy) ? m.seenBy : [],
            toUid: m.toUid || null,
          };
        });


        setRoom(roomFromApi);
        setInitialMessages(normalized);

        // mark this DM thread as read (for inbox counters)
        if (peerUid) {
          try {
            await markThreadRead(peerUid);
          } catch (err) {
            console.warn("[chat] markThreadRead failed:", err?.message || err);
          }
        }
      } catch (e) {
        console.warn("load chat history failed:", e?.message || e);
        setRoom(null);
        setInitialMessages([]);
      } finally {
        if (alive) setLoadingHistory(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [peerUid, currentUser, myUid, myLabel]);

  // 3) Attach socket + join room once we know the room id
  useEffect(() => {
  if (!room || !myLabel) return;

  let s;
  try {
    s = connectSocket(); // uses shared socket client from api.js
    setSocket(s);
    s.emit("room:join", { room, who: myLabel });

    // 🔥 tell backend we've read messages in this room
    s.emit("chat:read", { room }, (ack) => {
      console.log("chat:read ack =", ack);
    });
  } catch (e) {
    console.warn("chat connectSocket failed:", e?.message || e);
  }

  return () => {
    try {
      if (s && room) s.emit("room:leave", { room });
    } catch {}
    setSocket(null);
  };
}, [room, myLabel]);

  // ---------- guards ----------
if (meLoading) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <p className="text-sm text-zinc-400">Loading your account…</p>
    </div>
  );
}

if (!currentUser) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <p className="text-sm text-zinc-300">
        Please log in to use chat.
      </p>
      <button
        type="button"
        onClick={() => navigate("/login")}
        className="mt-3 px-4 py-2 rounded-lg bg-gold text-black font-semibold"
      >
        Go to login
      </button>
    </div>
  );
}

  if (!peerUid) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-3">
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="text-sm text-zinc-400">
          Open someone&apos;s profile and click{" "}
          <strong>Message</strong> to start a conversation.
        </p>
      </div>
    );
  }

  if (loadingHistory && !room) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <p className="text-sm text-zinc-400">Loading conversation…</p>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <p className="text-sm text-zinc-400">
          Could not prepare chat room. Try again from the profile.
        </p>
      </div>
    );
  }

  const peerName =
    peerProfile?.displayName || peerUid.slice(0, 6) + "…";
  const peerAvatar = peerProfile?.avatarUrl || "";

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* header like Messenger / TikTok center panel */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {peerAvatar ? (
            <img
              src={peerAvatar}
              alt={peerName}
              className="w-10 h-10 rounded-full object-cover border border-zinc-700"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-sm">
              {peerName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-lg font-semibold">{peerName}</h1>
            <p className="text-xs text-zinc-500">
              Social and everyday conversation (not tied to bookings).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
  {/* Voice / Audio call */}
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

      <div className="rounded-lg border border-zinc-800 bg-black/40 p-3 h-[60vh]">
        <ChatPane
          socket={socket}
          room={room}
          meUid={myUid}              // pass authoritative uid for dedupe/isMe
          myLabel={myLabel}          // display label for "You"
          toUid={peerUid}
          peerUid={peerUid}          // NEW: tell ChatPane who the peer is
          peerProfile={peerProfile}  // NEW: let ChatPane show name + avatar
          initialMessages={initialMessages}
        />
      </div>


      <CallSheet
  role="caller"
  room={callState.room}
  callId={callState.callId}
  callType={callState.callType}
  me={myLabel}
  open={callState.open}
  onClose={handleCallClose}
/>
    </div>
  );
}