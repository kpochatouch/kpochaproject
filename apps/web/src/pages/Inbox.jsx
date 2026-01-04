// apps/web/src/pages/Inbox.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  registerSocketHandler,
  getChatInbox,
  markThreadRead,
  markRoomRead,
  getPublicProfileByUid,
} from "../lib/api";
import { useMe } from "../context/MeContext.jsx";
import InboxList from "../components/Inbox.jsx"; // or the correct relative path
import RouteLoader from "../components/RouteLoader.jsx";
import useNotifications from "../hooks/useNotifications";
import MobileBackButton from "../components/MobileBackButton";


/* Configuration */
const MAX_THREADS = 200; // cap number of threads kept in memory
const SEARCH_DEBOUNCE_MS = 200;

/* Helpers (kept similar to your original) */
function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
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
}

function summarizeCallForPreview(callMeta = {}, currentUid) {
  const typeLabel = callMeta.type === "video" ? "Video call" : "Voice call";
  const status = callMeta.status || "";
  const direction =
    callMeta.direction ||
    (callMeta.fromUid && currentUid && callMeta.fromUid === currentUid
      ? "outgoing"
      : "incoming");

  if (status === "missed") {
    return direction === "outgoing"
      ? `Missed ${typeLabel} (you called)`
      : `Missed ${typeLabel}`;
  }

  if (status === "ended" || status === "accepted") {
    return direction === "outgoing"
      ? `${typeLabel} (you called)`
      : `${typeLabel} (they called you)`;
  }

  if (status === "dialing" || status === "ringing") {
    return `${typeLabel} · calling…`;
  }

  return typeLabel;
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

  const room = raw.room || raw.roomId || raw.threadId || null;

  const lastMessage = raw.lastMessage || raw.last || {};
  const lastMeta = lastMessage.meta || raw.lastMeta || {};

  let lastBody;

  if (lastMeta && lastMeta.call) {
    // 🔔 this thread’s last item is a call bubble
    lastBody = summarizeCallForPreview(lastMeta.call, currentUid);
  } else {
    lastBody =
      raw.lastBody ||
      lastMessage.body ||
      lastMessage.text ||
      (lastMessage.attachments && lastMessage.attachments.length
        ? "[Attachment]"
        : "");
  }

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

  const peerProfile = raw.peerProfile || raw.user || {};
  const displayName =
    peerProfile.displayName ||
    peerProfile.fullName ||
    peerProfile.username ||
    raw.peerName ||
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
  const { me: currentUser, loading: meLoading } = useMe();
    const { refreshCounts } = useNotifications();

  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);


  const myUid = currentUser?.uid || currentUser?.ownerUid || currentUser?._id || null;

  // debounce the search input into state (triggers re-render)
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSearch((search || "").trim().toLowerCase());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  const loadInbox = async ({ cursor: c = null, limit = 40, append = false } = {}) => {
  if (!myUid) return;
  if (append) setLoadingMore(true);
  else setLoading(true);

  setErrorMsg("");
  try {
    // Expect backend to accept cursor & limit and return { items, cursor, hasMore } if possible.
    const data = await getChatInbox({ cursor: c, limit });

    // normalize response shape (back-compat: array or { items })
    const raw = Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data)
      ? data
      : data?.threads || [];

    const normalized = raw
      .map((t) => normalizeThread(t, myUid))
      .filter((t) => !!t.peerUid);

    normalized.sort((a, b) => {
      const ta = a.lastAt ? new Date(a.lastAt).getTime() : 0;
      const tb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
      return tb - ta;
    });

    if (append) {
      setThreads((prev) => {
        const merged = [...prev, ...normalized];
        // dedupe by peerUid keeping first occurrence (which is newest after sort)
        const seen = new Set();
        const deduped = [];
        for (const t of merged) {
          if (seen.has(t.peerUid)) continue;
          seen.add(t.peerUid);
          deduped.push(t);
        }
        deduped.sort((a,b) => (b.lastAt? new Date(b.lastAt).getTime():0) - (a.lastAt? new Date(a.lastAt).getTime():0));
        return deduped.slice(0, MAX_THREADS);
      });
    } else {
      setThreads(normalized.slice(0, MAX_THREADS));
    }

    // set cursor/hasMore using response fields (backend-provided preferred)
    if (data?.cursor) setCursor(data.cursor);
    else if (normalized.length) {
      const last = normalized[normalized.length - 1];
      setCursor(last?.lastAt || null);
    } else {
      setCursor(null);
    }

    setHasMore(Boolean(data?.hasMore) || (normalized.length >= limit));
  } catch (e) {
    console.warn("[Inbox] loadInbox failed:", e?.message || e);
    if (!append) {
      setErrorMsg("Could not load your messages. Please try again.");
      setThreads([]);
    }
  } finally {
    setLoading(false);
    setLoadingMore(false);
  }
};

function handleLoadMore() {
  if (!hasMore || loadingMore) return;
  loadInbox({ cursor, limit: 40, append: true });
}

// initial load when we have a uid
useEffect(() => {
  if (!myUid) {
    setLoading(false);
    return;
  }
  // first page
  loadInbox();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [myUid]);


  // Socket: register handler for new chat messages
useEffect(() => {
  if (!myUid) return;

  // The socket connection itself is now handled in App.jsx.
  // Here we ONLY listen for "chat:message" events and update the inbox.
  const unregister = registerSocketHandler("chat:message", (msg) => {
    try {
      const fromUid = msg.fromUid || msg.from;
      const toUid = msg.toUid || msg.to;
      const room = msg.room || msg.roomId || null;

      if (!fromUid && !toUid) return;
      if (fromUid !== myUid && toUid !== myUid) return;

      const peerUid = fromUid === myUid ? toUid : fromUid;
      if (!peerUid) return;

      const meta = msg.meta || {};
      let body;

      if (meta.call) {
        body = summarizeCallForPreview(meta.call, myUid);
      } else {
        body =
          msg.body ||
          msg.text ||
          (msg.attachments && msg.attachments.length ? "[Attachment]" : "");
      }

      const at = msg.at || msg.ts || msg.createdAt || Date.now();

      setThreads((prev) => {
        const existingIndex = prev.findIndex((t) => t.peerUid === peerUid);
        let updatedThread;

        if (existingIndex >= 0) {
          const current = prev[existingIndex];
          const newUnread =
            fromUid === myUid ? current.unread : (current.unread || 0) + 1;

          updatedThread = {
            ...current,
            lastBody: body,
            lastAt: at,
            unread: newUnread,
            room: current.room || room || current.room,
          };

          const cloned = [...prev];
          cloned.splice(existingIndex, 1);
          // newest first, cap array length
          return [updatedThread, ...cloned].slice(0, MAX_THREADS);
        }

        // new thread
        updatedThread = {
          peerUid,
          room: room || null,
          unread: fromUid === myUid ? 0 : 1,
          lastBody: body,
          lastAt: at,
          // we do NOT know their profile name yet → show clear "Unknown user"
          displayName: "Unknown user",
          avatarUrl: "",
        };

        return [updatedThread, ...prev].slice(0, MAX_THREADS);
      });
    } catch (e) {
      console.warn(
        "[Inbox] socket chat:message handler failed:",
        e?.message || e
      );
    }
  });

  return () => {
    try {
      if (typeof unregister === "function") unregister();
    } catch {}
    // do NOT call setState during cleanup
  };
}, [myUid]);

// Socket: listen for dm:incoming (fires even when Inbox was not mounted)
useEffect(() => {
  if (!myUid) return;

  const unregister = registerSocketHandler("dm:incoming", (payload) => {
    try {
      const { room, fromUid, body, at } = payload || {};

      if (!fromUid || fromUid === myUid) return;

      const peerUid = fromUid;
      const ts = at || Date.now();

      setThreads((prev) => {
        const idx = prev.findIndex((t) => t.peerUid === peerUid);

        // Existing thread → bump unread
        if (idx >= 0) {
          const current = prev[idx];

          const updated = {
            ...current,
            lastBody: body || current.lastBody || "",
            lastAt: ts,
            unread: (current.unread || 0) + 1,
            room: current.room || room || null,
          };

          const clone = [...prev];
          clone.splice(idx, 1);
          return [updated, ...clone].slice(0, MAX_THREADS);
        }

        // New thread → create entry
        return [
          {
            peerUid,
            room: room || null,
            unread: 1,
            lastBody: body || "",
            lastAt: ts,
            displayName: "Unknown user",
            avatarUrl: "",
          },
          ...prev,
        ].slice(0, MAX_THREADS);
      });
    } catch (e) {
      console.warn("[Inbox] dm:incoming handler failed:", e?.message || e);
    }
  });

  return () => {
    try {
      unregister?.();
    } catch {}
  };
}, [myUid]);


  const filteredThreads = useMemo(() => {
    const term = (debouncedSearch || "").trim().toLowerCase();
    if (!term) return threads;
    return threads.filter((t) => {
      const haystack = `${t.displayName || ""} ${t.peerUid || ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [threads, debouncedSearch]);

    // Hydrate threads that still show "Unknown user" using public profiles
  useEffect(() => {
    let cancelled = false;

    async function hydrateMissingProfiles() {
      // find threads that have a peerUid but no proper displayName yet
      const missing = threads.filter(
        (t) =>
          t.peerUid &&
          (!t.displayName || t.displayName === "Unknown user")
      );

      if (!missing.length) return;

      const uniqueUids = [...new Set(missing.map((t) => t.peerUid))];
      const updates = {};

      for (const uid of uniqueUids) {
        try {
          const data = await getPublicProfileByUid(uid);
          const p = data?.profile || data;
          if (!p) continue;

          updates[uid] = {
            displayName:
              p.displayName ||
              p.fullName ||
              p.username ||
              "Unknown user",
            avatarUrl: p.avatarUrl || p.photoUrl || "",
          };
        } catch (e) {
          // ignore failures for individual users
          console.warn("[Inbox] hydrate profile failed for", uid, e?.message || e);
        }
      }

      if (cancelled) return;
      if (!Object.keys(updates).length) return;

      setThreads((prev) =>
        prev.map((t) =>
          updates[t.peerUid] ? { ...t, ...updates[t.peerUid] } : t
        )
      );
    }

    hydrateMissingProfiles();

    return () => {
      cancelled = true;
    };
  }, [threads]);


   async function openThread(t) {
    if (!t || !t.peerUid) return;

    // 1) Navigate to DM chat
    navigate(`/chat?with=${encodeURIComponent(t.peerUid)}`);

    // 2) Optimistic local update: clear unread for this peer
    setThreads((prev) =>
      prev.map((x) =>
        x.peerUid === t.peerUid ? { ...x, unread: 0 } : x
      )
    );

    // 3) Tell backend to zero the unread counter
    try {
      if (t.room) {
        // Prefer room if we have it (booking or DM)
        await markRoomRead(t.room);
      } else {
        // Fallback: DM pair-based read
        await markThreadRead(t.peerUid);
      }
      await refreshCounts();

    } catch (e) {
      console.warn("[Inbox] markThreadRead/markRoomRead failed:", e?.message || e);
    }
  }


    if (meLoading) {
    return <RouteLoader full />;
  }

  if (loading) {
  return <RouteLoader full />;
}


return (
  <div className="flex flex-col gap-4 max-w-4xl mx-auto px-4 py-6">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {/* Mobile back button */}
        <MobileBackButton fallback="/" />

        <div>
          <h1 className="text-2xl font-semibold">Messages</h1>
          <p className="text-xs text-zinc-500">
            Your social and everyday chats with other users.
          </p>
        </div>
      </div>
    </div>

    <div className="flex items-center gap-2">
      <input
        aria-label="Search conversations"
        type="text"
        className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-2 text-sm"
        placeholder="Search conversations…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <button
        type="button"
        onClick={() => loadInbox()}
        title="Refresh"
        className="px-3 py-2 rounded-lg border border-zinc-800 text-sm"
      >
        Refresh
      </button>
    </div>

    {errorMsg && (
      <div className="text-xs text-red-400 border border-red-800/60 bg-red-950/10 rounded-lg px-3 py-2 flex items-center justify-between">
        <span>{errorMsg}</span>
        <button onClick={() => loadInbox()} className="text-xs underline">
          Retry
        </button>
      </div>
    )}

    {!loading && filteredThreads.length === 0 && !errorMsg && (
      <div className="border border-zinc-800 rounded-xl bg-black/40 px-4 py-10 text-center text-sm text-zinc-400">
        <p>No conversations yet.</p>
        <p className="mt-1">
          Open someone&apos;s profile and tap <span className="font-semibold">Message</span> to start chatting.
        </p>
      </div>
    )}

    {!loading && filteredThreads.length > 0 && (
      <InboxList
        threads={filteredThreads}
        onOpen={openThread}
        loading={loading}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        formatTime={formatTime}
      />
    )}
  </div>
);
}
