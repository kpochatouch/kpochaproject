// apps/web/src/pages/Chat.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  connectSocket,
  getChatWith,
  getPublicProfileByUid,
  markThreadRead,
  initiateCall,
  sendChatMessage,
} from "../lib/api";
import { useMe } from "../context/MeContext.jsx";
import ChatPane from "../components/ChatPane.jsx";
import RouteLoader from "../components/RouteLoader.jsx";
import MobileBackButton from "../components/MobileBackButton.jsx";
import DisplayName from "../components/DisplayName.jsx";

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function Chat() {
  const navigate = useNavigate();
  const query = useQuery();
  const { me: currentUser, loading: meLoading } = useMe();
  const startCallType = query.get("call"); // "audio" | "video" | null

  const [socket, setSocket] = useState(null);
  const [room, setRoom] = useState(null);
  const [initialMessages, setInitialMessages] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [peerProfile, setPeerProfile] = useState(null);

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
    "";

  const meReady = Boolean(
    !meLoading &&
      currentUser &&
      (currentUser?.uid ||
        currentUser?.ownerUid ||
        currentUser?._id ||
        currentUser?.id ||
        currentUser?.userId),
  );

  // ------------------ CALL HELPERS ------------------ //

  // 👇 paste this helper EXACTLY here
  function buildCallMeta({
    direction = "outgoing",
    type = "audio",
    status = "dialing",
    callId = null,
  } = {}) {
    return {
      call: {
        direction, // "outgoing" | "incoming"
        type, // "audio" | "video"
        status, // "dialing" | "ringing" | "accepted" | "ended" | "missed" | "cancelled"
        callId,
      },
    };
  }

  async function handleStartCall(callType = "audio") {
    if (!peerUid) return;

    if (!meReady || !myUid) {
      alert(
        "Your account is still loading. Please wait a moment and try again.",
      );
      return;
    }

    // ✅ STEP 1: request mic/cam FIRST (so we don't create a call record if blocked)
    try {
      const constraints =
        callType === "video" ? { audio: true, video: true } : { audio: true };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      console.error("[Chat] getUserMedia failed:", e);
      alert(
        "Could not start call.\n\nPlease allow Microphone (and Camera for video).\nSettings → Apps → Kpocha Touch → Permissions.",
      );
      return; // ✅ IMPORTANT: do NOT call initiateCall()
    }

    // build meta so receiver sees real caller info
    const fromAvatar =
      currentUser?.avatarUrl ||
      currentUser?.photoUrl ||
      currentUser?.photoURL ||
      "";

    const meta = {
      fromUid: myUid,
      fromName: myLabel || "User",
      fromAvatar,
      peerUid,
      chatRoom: room || null,
      source: "dm_chat",
    };

    try {
      const ack = await initiateCall({
        receiverUid: peerUid,
        callType,
        meta,
      });

      const callRoom = ack.room;
      const callId = ack.callId || null;

      if (!callRoom) {
        console.warn("[chat] initiateCall returned no room:", ack);
        alert("Could not start call.");
        return;
      }

      window.dispatchEvent(
        new CustomEvent("kpocha:start-call", {
          detail: {
            role: "caller",
            room: callRoom,
            callId,
            callType: ack.callType || callType,
            meta: {
              peerName,
              peerAvatar,
              peerVerified,
              chatRoom: room || null,
              chatPath: `/chat?with=${encodeURIComponent(peerUid)}`,
              source: "dm_chat",
            },
          },
        }),
      );

      // only write call bubble if call actually started
      if (room) {
        try {
          await sendChatMessage({
            room,
            text: "",
            meta: buildCallMeta({
              direction: "outgoing",
              type: ack.callType || callType,
              status: "dialing",
              callId,
            }),
          });
        } catch (err) {
          console.warn(
            "[chat] could not write call bubble:",
            err?.message || err,
          );
        }
      }
    } catch (e) {
      console.error("start call failed:", e);
      alert("Could not start call. Please try again.");
    }
  }

  // ------------------ PEER PROFILE ------------------ //

  // 1) Load peer profile (to show name + avatar)
  useEffect(() => {
    if (!peerUid) return;
    let alive = true;

    (async () => {
      try {
        const data = await getPublicProfileByUid(peerUid);
        if (!alive) return;

        const p = data?.profile || data;

        if (p) {
          setPeerProfile({
            displayName: p.displayName || p.fullName || p.username || "",
            avatarUrl: p.avatarUrl || p.photoUrl || "",
            verified: !!p.verified,
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

  // ------------------ CHAT HISTORY ------------------ //

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
            sender: m.sender || null,
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

  // ------------------ SOCKET SETUP ------------------ //

  // 3) Attach socket + join room once we know the room id
  useEffect(() => {
    if (!room || !myLabel) return;

    const s = connectSocket(); // should return the shared singleton
    setSocket(s);

    function joinRoom() {
      if (!room) return;

      console.log("[Chat.jsx] room:join →", room);
      s.emit("room:join", { room, who: myLabel });

      console.log("[Chat.jsx] chat:read EMIT →", { room });
      s.emit("chat:read", { room }, (ack) => {
        console.log("[Chat.jsx] chat:read ACK ←", ack);
      });
    }

    // join immediately
    joinRoom();

    // 👇 re-join on every reconnect so we don't lose the room
    s.on("connect", joinRoom);

    return () => {
      try {
        s.off("connect", joinRoom);
        if (room) s.emit("room:leave", { room });
      } catch (e) {
        console.warn("chat cleanup failed:", e?.message || e);
      }
      setSocket(null);
    };
  }, [room, myLabel]);

  // 🔥 Auto-start call when URL has ?call=audio or ?call=video
  useEffect(() => {
    if (!startCallType) return; // no call param → do nothing
    if (!peerUid) return; // no peer to call
    if (!room) return; // DM room not ready yet
    if (!currentUser || !myUid) return;

    const id = setTimeout(() => {
      handleStartCall(startCallType);
    }, 300);

    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCallType, peerUid, room, currentUser, myUid]);

  // ------------------ GUARDS ------------------ //

  if (meLoading) {
    return <RouteLoader full />;
  }

  if (!currentUser) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <p className="text-sm text-zinc-300">Please log in to use chat.</p>
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
          Open someone&apos;s profile and click <strong>Message</strong> to
          start a conversation.
        </p>
      </div>
    );
  }

  if (loadingHistory && !room) {
    return <RouteLoader full />;
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

  const peerName = peerProfile?.displayName || "User";
  const peerAvatar = peerProfile?.avatarUrl || "";
  const peerVerified = Boolean(peerProfile?.verified);

  // ------------------ RENDER ------------------ //

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* header like Messenger / TikTok center panel */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {/* Mobile back button */}
            <MobileBackButton fallback="/inbox" />

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
              <h1 className="text-lg font-semibold">
                <DisplayName
                  name={peerName}
                  verified={peerVerified}
                  badgeClassName="w-4 h-4"
                />
              </h1>
              <p className="text-xs text-zinc-500">
                Social and everyday conversation (not tied to bookings).
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Voice call */}
          <button
            onClick={() => handleStartCall("audio")}
            title="Voice call"
            className="p-2 rounded-full bg-gold text-black hover:bg-[#d6b639]"
          >
            📞
          </button>

          {/* Video call */}
          <button
            onClick={() => handleStartCall("video")}
            title="Video call"
            className="p-2 rounded-full bg-gold text-black hover:bg-[#d6b639]"
          >
            🎥
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-black/40 p-3 h-[60vh]">
        <ChatPane
          socket={socket}
          room={room}
          meUid={myUid}
          myLabel={myLabel}
          toUid={peerUid}
          peerUid={peerUid}
          peerProfile={peerProfile}
          initialMessages={initialMessages}
        />
      </div>
    </div>
  );
}
