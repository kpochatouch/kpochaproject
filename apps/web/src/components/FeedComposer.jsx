// apps/web/src/components/FeedComposer.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

/**
 * FeedComposer (compact launcher only)
 * - Inline feed launcher that opens /compose
 * - Intentionally small so it stops taking unnecessary space
 */
export default function FeedComposer({ inline = true } = {}) {
  const navigate = useNavigate();

  function openCompose() {
    navigate("/compose");
  }

  if (!inline) return null;

  return (
    <div className="mb-4 w-full max-w-2xl mx-auto flex justify-end">
      <button
        type="button"
        onClick={openCompose}
        aria-label="Create post"
        title="Create post"
        className="w-12 h-12 rounded-full bg-gold text-black text-2xl font-semibold flex items-center justify-center shadow-md hover:scale-[1.03] active:scale-[0.98] transition"
      >
        +
      </button>
    </div>
  );
}
