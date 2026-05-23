import React from "react";

export default function SkeletonFeed({ items = 4 }) {
  const arr = Array.from({ length: items });
  return (
    <div className="space-y-4">
      {arr.map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-zinc-800 p-4 bg-[linear-gradient(90deg,#0b0b0b, #111111)] animate-pulse"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-zinc-700" />
            <div className="flex-1">
              <div className="w-1/3 h-3 bg-zinc-700 mb-2 rounded" />
              <div className="w-1/6 h-2 bg-zinc-700 rounded" />
            </div>
          </div>

          <div className="w-full h-44 bg-zinc-700 rounded mb-3" />

          <div className="w-full h-3 bg-zinc-700 rounded mb-2" />
          <div className="w-5/6 h-3 bg-zinc-700 rounded" />
        </div>
      ))}
    </div>
  );
}
