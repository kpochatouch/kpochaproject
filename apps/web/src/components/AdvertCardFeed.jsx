//apps/web/src/components/AdvertCardFeed.jsx
import { useEffect, useRef } from "react";
import { api } from "../lib/api";

export default function AdvertCardFeed({ advert, onClickAction }) {
  const seenRef = useRef(false);

  useEffect(() => {
    if (!advert?._id || seenRef.current) return;
    seenRef.current = true;
    api.post(`/api/adverts/${advert._id}/impression`).catch(() => {});
  }, [advert?._id]);

  if (!advert) return null;

  const media = advert.media?.[0];

  return (
    <article
      className="rounded-2xl border overflow-hidden"
      style={{
        borderColor: "var(--app-border)",
        backgroundColor: "var(--app-surface)",
        color: "var(--app-text)",
      }}
    >
      <div className="px-4 pt-4">
        <div
          className="text-[11px] uppercase tracking-[0.16em] font-semibold"
          style={{ color: "var(--app-text-soft)" }}
        >
          Sponsored
        </div>
      </div>

      {media?.type === "video" ? (
        <video
          src={media?.url}
          controls
          className="w-full max-h-[560px] object-cover mt-3"
          onClick={() => onClickAction?.(advert)}
        />
      ) : media?.url ? (
        <img
          src={media.url}
          alt={advert.title || "Advert"}
          className="w-full max-h-[560px] object-cover mt-3"
          onClick={() => onClickAction?.(advert)}
        />
      ) : null}

      <div className="p-5">
        <div className="text-[18px] font-semibold leading-6">
          {advert.title || "Advert"}
        </div>
        <div
          className="text-[16px] leading-7 mt-2"
          style={{ color: "var(--app-text-soft)" }}
        >
          {advert.text || ""}
        </div>

        <button
          onClick={() => onClickAction?.(advert)}
          className="mt-5 rounded-xl bg-white text-black px-5 py-2.5 text-[15px] font-semibold"
        >
          {advert.buttonLabel || "Learn more"}
        </button>
      </div>
    </article>
  );
}
