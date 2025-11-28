// apps/web/src/pages/Inbox.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, registerSocketHandler } from "../lib/api";
import { useMe } from "../context/MeContext.jsx";

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";

  try {
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    if (sameDay) {
      return new Intl.DateTimeFormat("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
    }

    return new Intl.DateTimeFormat("en-NG", {
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

function normalizeThread(raw = {}, currentUid) {
  const peerUid =
    raw.peerUid ||
    raw.withUid ||
    raw.otherUid ||
    (raw.participants &&
      Array.isArray(raw.participants) &&
      raw.participants.find((u) => u && u !== currentUid)) ||
    null;

  const room = raw.room || raw.roomId || null;

  const lastMessage = raw.lastMessage || raw.last || {};
  const lastBody =
    raw.lastBody ||
    lastMessage.body ||
    lastMessage.text ||
    (lastMessage.attachments && lastMessage.attachments.length
      ? "[Attachment]"
      : "");

  const lastAt =
    raw.lastAt ||
    lastMessage.at ||
    lastMessage.createdAt ||
    lastMessage.ts ||
    raw.updatedAt ||
    null;

  const unread =
    typeof raw.unread === "number"
      ? raw.unread
      : typeof raw.unreadCount === "number"
      ? raw.unreadCount
      : 0;

  const peerProfile = raw.peerProfile || {};
  const displayName =
    peerProfile.displayName ||
    peerProfile.fullName ||
    peerProfile.username ||
    raw.peerName ||
    peerUid ||
    "Unknown user";

  const avatarUrl =
    peerProfile.avatarUrl || peerProfile.photoUrl || raw.avatarUrl || "";

  return {
    peerUid,
    room,
    unread,
    lastBody,
    lastAt,
    displayName,
    avatarUrl,
  };
}

export default function Inbox() {
  const navigate = useNavigate();
  const { me: currentUser } = useMe();

  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [search, setSearch] = useState("");

  const myUid =
    currentUser?.uid ||
    currentUser?.ownerUid ||
    currentUser?._id ||
    currentUser?.id ||
    currentUser?.userId ||
    null;

  // Load inbox on mount
  useEffect(() => {
    if (!myUid) {
      setLoading(false);
      return;
    }

    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErrorMsg("");

        const { data } = await api.get("/api/chat/inbox");
        const raw = Array.isArray(data?.threads)
          ? data.threads
          : Array.isArray(data)
          ? data
          : [];

        const normalized = raw
          .map((t) => normalizeThread(t, myUid))
          .filter((t) => !!t.peerUid);

        // sort newest first
        normalized.sort((a, b) => {
          const ta = a.lastAt ? new Date(a.lastAt).getTime() : 0;
          const tb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
          return tb - ta;
        });

        if (!alive) return;
        setThreads(normalized);
      } catch (e) {
        console.warn("[Inbox] load inbox failed:", e?.message || e);
        if (alive) {
          setErrorMsg("Could not load your messages. Please try again.");
          setThreads([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [myUid]);

  // Live update from socket: chat:message
  useEffect(() => {
    if (!myUid) return;

    const unregister = registerSocketHandler("chat:message", (msg) => {
      try {
        const fromUid = msg.fromUid || msg.from;
        const toUid = msg.toUid || msg.to;
        const room = msg.room || msg.roomId || null;

        if (!fromUid && !toUid) return;

        // Only care about messages where I am sender or recipient
        if (fromUid !== myUid && toUid !== myUid) return;

        const peerUid = fromUid === myUid ? toUid : fromUid;
        if (!peerUid) return;

        const body =
          msg.body ||
          msg.text ||
          (msg.attachments && msg.attachments.length ? "[Attachment]" : "");
        const at = msg.at || msg.ts || msg.createdAt || Date.now();

        setThreads((prev) => {
          // Find existing thread
          const existingIndex = prev.findIndex(
            (t) => t.peerUid === peerUid
          );
          let updatedThread;

          if (existingIndex >= 0) {
            const current = prev[existingIndex];
            const newUnread =
              fromUid === myUid
                ? current.unread // my own sent message → don't increase unread
                : (current.unread || 0) + 1;

            updatedThread = {
              ...current,
              lastBody: body,
              lastAt: at,
              unread: newUnread,
              room: current.room || room || current.room,
            };

            const cloned = [...prev];
            cloned.splice(existingIndex, 1);
            return [updatedThread, ...cloned];
          }

          // New thread
          updatedThread = {
            peerUid,
            room: room || null,
            unread: fromUid === myUid ? 0 : 1,
            lastBody: body,
            lastAt: at,
            displayName: peerUid,
            avatarUrl: "",
          };

          return [updatedThread, ...prev];
        });
      } catch (e) {
        console.warn("[Inbox] socket chat:message handler failed:", e?.message || e);
      }
    });

    return () => {
      if (typeof unregister === "function") unregister();
    };
  }, [myUid]);

  const filteredThreads = useMemo(() => {
    const term = (search || "").trim().toLowerCase();
    if (!term) return threads;
    return threads.filter((t) => {
      const haystack = `${t.displayName || ""} ${t.peerUid || ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [threads, search]);

  if (!currentUser) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <p className="text-sm text-zinc-300">
          Please log in to view your messages.
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

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Messages</h1>
          <p className="text-xs text-zinc-500">
            Your social and everyday chats with other users.
          </p>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2 text-sm"
          placeholder="Search conversations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Error state */}
      {errorMsg && (
        <div className="text-xs text-red-400 border border-red-800/60 bg-red-950/10 rounded-lg px-3 py-2">
          {errorMsg}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse flex items-center justify-between border border-zinc-900 rounded-lg px-3 py-3 bg-black/40"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-zinc-800" />
                <div className="space-y-2">
                  <div className="h-3 w-24 bg-zinc-800 rounded" />
                  <div className="h-3 w-40 bg-zinc-900 rounded" />
                </div>
              </div>
              <div className="h-3 w-10 bg-zinc-900 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredThreads.length === 0 && !errorMsg && (
        <div className="border border-zinc-800 rounded-xl bg-black/40 px-4 py-10 text-center text-sm text-zinc-400">
          <p>No conversations yet.</p>
          <p className="mt-1">
            Open someone&apos;s profile and tap{" "}
            <span className="font-semibold">Message</span> to start chatting.
          </p>
        </div>
      )}

      {/* Threads list */}
      {!loading && filteredThreads.length > 0 && (
        <div className="space-y-2">
          {filteredThreads.map((t) => {
            const timeText = formatTime(t.lastAt);
            const initial =
              (t.displayName || t.peerUid || "?").slice(0, 1).toUpperCase();

            return (
              <button
                key={t.peerUid}
                type="button"
                onClick={() => {
                  navigate(`/chat?with=${encodeURIComponent(t.peerUid)}`);
                  // Optimistic: mark as read locally; backend will be updated by Chat page
                  setThreads((prev) =>
                    prev.map((x) =>
                      x.peerUid === t.peerUid ? { ...x, unread: 0 } : x
                    )
                  );
                }}
                className="w-full flex items-center justify-between gap-3 border border-zinc-800 rounded-xl px-3 py-3 bg-black/40 hover:bg-zinc-900/50 transition"
              >
                <div className="flex items-center gap-3 text-left">
                  {t.avatarUrl ? (
                    <img
                      src={t.avatarUrl}
                      alt={t.displayName}
                      className="w-10 h-10 rounded-full object-cover border border-zinc-700"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-sm">
                      {initial}
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate max-w-[160px]">
                        {t.displayName}
                      </span>
                      {t.unread > 0 && (
                        <span className="inline-flex items-center justify-center text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1 bg-gold text-black">
                          {t.unread > 99 ? "99+" : t.unread}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 truncate max-w-[220px]">
                      {t.lastBody || "Tap to open conversation"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  {timeText && (
                    <span className="text-[10px] text-zinc-500">
                      {timeText}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
