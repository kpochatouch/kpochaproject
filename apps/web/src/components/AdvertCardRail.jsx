//apps/web/src/components/AdvertCardRail.jsx
import { useEffect, useRef } from "react";
import { api } from "../lib/api";

export default function AdvertCardRail({ advert, onClickAction }) {
  const seenRef = useRef(false);

  useEffect(() => {
    if (!advert?._id || seenRef.current) return;
    seenRef.current = true;
    api.post(`/api/adverts/${advert._id}/impression`).catch(() => {});
  }, [advert?._id]);

  if (!advert) {
    return (
      <div
        className="h-44 rounded-2xl border flex items-center justify-center text-sm"
        style={{
          borderColor: "var(--app-border)",
          backgroundColor: "var(--app-surface)",
          color: "var(--app-text-soft)",
        }}
      >
        Advert space
      </div>
    );
  }

  const media = advert.media?.[0];

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{
        backgroundColor: "var(--app-surface)",
        borderColor: "var(--app-border)",
        color: "var(--app-text)",
      }}
    >
      <div
        className="px-4 pt-4 text-[11px] uppercase tracking-[0.16em] font-semibold"
        style={{ color: "var(--app-text-soft)" }}
      >
        Sponsored
      </div>

      <button
        type="button"
        onClick={() => onClickAction?.(advert)}
        className="block w-full text-left"
      >
        {media?.type === "video" ? (
          <video
            src={media.url}
            muted
            loop
            playsInline
            autoPlay
            className="w-full h-48 object-cover mt-3"
          />
        ) : media?.url ? (
          <img
            src={media.url}
            alt={advert.title || "Advert"}
            className="w-full h-48 object-cover mt-3"
          />
        ) : null}
      </button>

      <div className="p-4">
        <div className="text-[16px] font-semibold leading-6 line-clamp-2">
          {advert.title || "Advert"}
        </div>

        {!!advert.text && (
          <div
            className="mt-2 text-[14px] leading-6 line-clamp-3"
            style={{ color: "var(--app-text-soft)" }}
          >
            {advert.text}
          </div>
        )}

        <button
          onClick={() => onClickAction?.(advert)}
          className="mt-4 w-full rounded-xl bg-white text-black px-4 py-2.5 text-[15px] font-semibold"
        >
          {advert.buttonLabel || "Learn more"}
        </button>
      </div>
    </div>
  );
}
