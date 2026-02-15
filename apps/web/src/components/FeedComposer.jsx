// apps/web/src/components/FeedComposer.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * FeedComposer (inline launcher only)
 * - This is NOT the real composer anymore.
 * - /compose is the one true composer (pages/Compose.jsx).
 */
export default function FeedComposer({ inline = true } = {}) {
  const navigate = useNavigate();
  const [text, setText] = useState("");

  function openCompose() {
    navigate("/compose");
  }

  if (!inline) return null;

  return (
    <div className="mb-4 p-3 rounded-xl border border-zinc-800 bg-black/30 w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold text-white text-sm">Share an update</h3>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 200))}
        onFocus={openCompose}
        placeholder="Tap to write a longer post…"
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 mb-2 outline-none focus:border-gold text-sm min-h-[50px]"
      />

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={openCompose}
          className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-white hover:bg-zinc-900"
        >
          Open composer
        </button>

        <button
          type="button"
          onClick={openCompose}
          className="rounded-lg bg-gold text-black px-4 py-1.5 text-sm font-semibold"
        >
          Post
        </button>
      </div>
    </div>
  );
}
