import React from "react";

export default function MatchProgress({ matchId, searching }) {
  return (
    <div className="rounded-xl border border-zinc-800 p-6 bg-black/40">
      <div className="text-center">
        <div className="text-lg font-medium mb-2">{searching ? "Searching…" : "Starting search"}</div>
        <div className="text-sm text-zinc-400 mb-4">We are looking for nearby professionals. This usually takes a few seconds.</div>
        {matchId && <div className="text-xs text-zinc-500">Search ID: {matchId}</div>}
      </div>
    </div>
  );
}
