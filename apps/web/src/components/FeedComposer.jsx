// apps/web/src/components/FeedComposer.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

export default function FeedComposer({ inline = true } = {}) {
  const navigate = useNavigate();

  function openCompose() {
    navigate("/compose");
  }

  if (!inline) return null;

  return (
    <div className="mb-3 w-full">
      <button
        type="button"
        onClick={openCompose}
        aria-label="Create post"
        title="Create post"
        className="w-full rounded-2xl border px-4 py-3.5 flex items-center gap-3 text-left transition hover:opacity-95"
        style={{
          backgroundColor: "var(--app-surface)",
          borderColor: "var(--app-border)",
          color: "var(--app-text)",
        }}
      >
        <span className="w-11 h-11 rounded-full bg-gold text-black text-3xl font-semibold flex items-center justify-center shrink-0">
          +
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-medium">
            Share something with people around you
          </span>
          <span
            className="block text-[13px] mt-0.5"
            style={{ color: "var(--app-text-soft)" }}
          >
            Post text, photo, or video
          </span>
        </span>
      </button>
    </div>
  );
}
