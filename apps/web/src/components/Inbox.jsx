// apps/web/src/components/Inbox.jsx
import React from "react";

/**
 * Props:
 * - threads: array of normalized thread objects
 * - onOpen(thread)
 * - loading: boolean (initial load)
 * - hasMore: boolean (pagination)
 * - loadingMore: boolean
 * - onLoadMore(): loads next page
 * - formatTime(ts): helper to format timestamp
 */
export function ThreadItem({ t, onOpen, formatTime }) {
  const timeText = formatTime?.(t.lastAt) || "";
  const initial = (t.displayName || t.peerUid || "?").slice(0, 1).toUpperCase();

  return (
    <button
      type="button"
      onClick={() => onOpen && onOpen(t)}
      className="w-full flex items-center justify-between gap-3 border border-zinc-800 rounded-xl px-3 py-3 bg-black/40 hover:bg-zinc-900/50 transition"
      aria-label={`Open conversation with ${t.displayName}`}
    >
      <div className="flex items-center gap-3 text-left min-w-0">
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

        <div className="min-w-0">
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
          <span className="text-[10px] text-zinc-500">{timeText}</span>
        )}
      </div>
    </button>
  );
}

export default function InboxList({
  threads = [],
  onOpen,
  loading = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  formatTime,
}) {
  if (loading) {
    return (
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
    );
  }

  if (!loading && threads.length === 0) {
    return (
      <div className="border border-zinc-800 rounded-xl bg-black/40 px-4 py-10 text-center text-sm text-zinc-400">
        <p>No conversations yet.</p>
        <p className="mt-1">
          Open someone&apos;s profile and tap{" "}
          <span className="font-semibold">Message</span> to start chatting.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {threads.map((t, i) => (
          <ThreadItem
            key={t.room || t.peerUid || `thread-${i}`}
            t={t}
            onOpen={onOpen}
            formatTime={formatTime}
          />
        ))}
      </div>

      <div className="flex justify-center mt-3">
        {hasMore ? (
          <button
            className="px-4 py-2 rounded-lg border border-zinc-800 text-sm"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        ) : (
          <span className="text-xs text-zinc-500">No more conversations</span>
        )}
      </div>
    </>
  );
}
