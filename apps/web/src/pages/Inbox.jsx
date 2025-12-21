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
import InboxList from "../components/Inbox.jsx";
import RouteLoader from "../components/RouteLoader.jsx";

/* Configuration */
const MAX_THREADS = 200;
const SEARCH_DEBOUNCE_MS = 200;

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return new Intl.DateTimeFormat("en-NG", { hour: "2-digit", minute: "2-digit" }).format(d);
  return new Intl.DateTimeFormat("en-NG", { month: "short", day: "numeric" }).format(d);
}

function summarizeCallForPreview(callMeta = {}, currentUid) {
  const typeLabel = callMeta.type === "video" ? "Video call" : "Voice call";
  const status = callMeta.status || "";
  const direction =
    callMeta.direction ||
    (callMeta.fromUid && currentUid && callMeta.fromUid === currentUid ? "outgoing" : "incoming");

  if (status === "missed") return direction === "outgoing" ? `Missed ${typeLabel} (you called)` : `Missed ${typeLabel}`;
  if (status === "ended" || status === "accepted") return direction === "outgoing" ? `${typeLabel} (you called)` : `${typeLabel} (they called you)`;
  if (status === "dialing" || status === "ringing") return `${typeLabel} · calling…`;
  return typeLabel;
}

function normalizeThread(raw = {}, currentUid) {
  const peerUid =
    raw.peerUid ||
    raw.withUid ||
    raw.otherUid ||
    (raw.participants && Array.isArray(raw.participants) && raw.participants.find((u) => u && u !== currentUid)) ||
    null;

  const room = raw.room || raw.roomId || raw.threadId || null;
  const lastMessage = raw.lastMessage || raw.last || {};
  const lastMeta = lastMessage.meta || raw.lastMeta || {};

  let lastBody;
  if (lastMeta && lastMeta.call) lastBody = summarizeCallForPreview(lastMeta.call, currentUid);
  else lastBody =
    raw.lastBody ||
    lastMessage.body ||
    lastMessage.text ||
    (lastMessage.attachments && lastMessage.attachments.length ? "[Attachment]" : "");

  const lastAt = raw.lastAt || lastMessage.at || lastMessage.createdAt || lastMessage.ts || raw.updatedAt || null;
 const unread =
  typeof raw.unreadCount === "number"
    ? raw.unreadCount
    : 0;

  const peerProfile = raw.peerProfile || raw.user || {};
  const displayName = peerProfile.displayName || peerProfile.fullName || peerProfile.username || raw.peerName || "Unknown user";
  const avatarUrl = peerProfile.avatarUrl || peerProfile.photoUrl || raw.avatarUrl || "";

  return { peerUid, room, unread, lastBody, lastAt, displayName, avatarUrl };
}

export default function Inbox() {
  const navigate = useNavigate();
  const { me: currentUser, loading: meLoading } = useMe();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  const myUid = currentUser?.uid || currentUser?.ownerUid || currentUser?._id || null;

  // Debounce search input
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch((search || "").trim().toLowerCase()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  // Load inbox
  const loadInbox = async ({ cursor: c = null, limit = 40, append = false } = {}) => {
    if (!myUid) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setErrorMsg("");
    try {
      const data = await getChatInbox({ cursor: c, limit });
      const raw = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : data?.threads || [];
      const normalized = raw.map((t) => normalizeThread(t, myUid)).filter((t) => !!t.peerUid);
      normalized.sort((a, b) => (b.lastAt ? new Date(b.lastAt).getTime() : 0) - (a.lastAt ? new Date(a.lastAt).getTime() : 0));
      if (append) {
        setThreads((prev) => {
          const merged = [...prev, ...normalized];
          const seen = new Set();
          const deduped = [];
          for (const t of merged) {
            if (seen.has(t.peerUid)) continue;
            seen.add(t.peerUid);
            deduped.push(t);
          }
          return deduped.slice(0, MAX_THREADS);
        });
      } else setThreads(normalized.slice(0, MAX_THREADS));

      setCursor(data?.cursor || (normalized.length ? normalized[normalized.length - 1]?.lastAt : null));
      setHasMore(Boolean(data?.hasMore) || normalized.length >= limit);
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

  useEffect(() => { if (myUid) loadInbox(); else setLoading(false); }, [myUid]);

  const handleLoadMore = () => { if (hasMore && !loadingMore) loadInbox({ cursor, limit: 40, append: true }); };

  // Socket listener
    useEffect(() => {
      if (!myUid) return;

      // New message listener
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
          const body = meta.call
            ? summarizeCallForPreview(meta.call, myUid)
            : msg.body || msg.text || (msg.attachments?.length ? "[Attachment]" : "");
          const at = msg.at || msg.ts || msg.createdAt || Date.now();

          const isUnread = !(msg.seenBy || []).includes(myUid); // server tells if it's seen

          setThreads((prev) => {
            const existingIndex = prev.findIndex((t) => t.peerUid === peerUid);

            if (existingIndex >= 0) {
              const current = prev[existingIndex];
              const updated = {
                ...current,
                lastBody: body,
                lastAt: at,
                unread: isUnread ? (current.unread || 0) + 1 : current.unread,

                room: current.room || room || null,
              };
              const copy = [...prev];
              copy[existingIndex] = updated;
              return copy;
            } else {
              return [
                {
                  peerUid,
                  lastBody: body,
                  lastAt: at,
                  unread: isUnread ? 1 : 0,

                  room: room || null,
                  displayName: "Unknown user",
                  avatarUrl: "",
                },
                ...prev,
              ].slice(0, MAX_THREADS);
            }
          });
        } catch (e) {
          console.warn("[Inbox] socket chat:message failed:", e?.message || e);
        }
      });

      // Listener for messages marked as seen
      const unregisterSeen = registerSocketHandler("chat:seen", (payload) => {
        if (!payload?.room) return;
        setThreads((prev) =>
          prev.map((t) =>
            t.room === payload.room ? { ...t, unread: 0 } : t
          )
        );
      });

      // Cleanup listeners when component is closed
      return () => {
        try {
          unregister?.();
          unregisterSeen?.();
        } catch {}
      };
    }, [myUid]);

  // Hydrate missing profiles
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const missing = threads.filter((t) => t.peerUid && (!t.displayName || t.displayName === "Unknown user"));
      if (!missing.length) return;
      const uniqueUids = [...new Set(missing.map((t) => t.peerUid))];
      const updates = {};
      for (const uid of uniqueUids) {
        try {
          const data = await getPublicProfileByUid(uid);
          const p = data?.profile || data;
          if (!p) continue;
          updates[uid] = { displayName: p.displayName || p.fullName || p.username || "Unknown user", avatarUrl: p.avatarUrl || p.photoUrl || "" };
        } catch {}
      }
      if (cancelled || !Object.keys(updates).length) return;
      setThreads((prev) => prev.map((t) => (updates[t.peerUid] ? { ...t, ...updates[t.peerUid] } : t)));
    }
    hydrate();
    return () => { cancelled = true; };
  }, [threads]);

  // Open thread
  async function openThread(t) {
    if (!t?.peerUid) return;
    navigate(`/chat?with=${encodeURIComponent(t.peerUid)}`);
    setThreads((prev) => prev.map((x) => (x.peerUid === t.peerUid ? { ...x, unread: 0 } : x)));
    try { if (t.peerUid) await markThreadRead(t.peerUid); else if (t.room) await markRoomRead(t.room); } catch {}
  }

  // Filtered threads for search
  const filteredThreads = useMemo(() => {
    const term = (debouncedSearch || "").trim().toLowerCase();
    if (!term) return threads;
    return threads.filter((t) => `${t.displayName || ""} ${t.peerUid || ""}`.toLowerCase().includes(term));
  }, [threads, debouncedSearch]);

  // Total unread count for badge
  const inboxUnread = useMemo(() => threads.reduce((acc, t) => acc + (t.unread || 0), 0), [threads]);

  if (meLoading) return <RouteLoader full />;
  if (loading) return <RouteLoader full />;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Messages {inboxUnread > 0 && <span className="ml-2 text-sm font-medium text-red-500">({inboxUnread})</span>}</h1>
          <p className="text-xs text-zinc-500">Your social and everyday chats with other users.</p>
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
        <button type="button" onClick={() => loadInbox()} title="Refresh" className="px-3 py-2 rounded-lg border border-zinc-800 text-sm">Refresh</button>
      </div>

      {errorMsg && (
        <div className="text-xs text-red-400 border border-red-800/60 bg-red-950/10 rounded-lg px-3 py-2 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => loadInbox()} className="text-xs underline">Retry</button>
        </div>
      )}

      {!loading && filteredThreads.length === 0 && !errorMsg && (
        <div className="border border-zinc-800 rounded-xl bg-black/40 px-4 py-10 text-center text-sm text-zinc-400">
          <p>No conversations yet.</p>
          <p className="mt-1">Open someone&apos;s profile and tap <span className="font-semibold">Message</span> to start chatting.</p>
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
