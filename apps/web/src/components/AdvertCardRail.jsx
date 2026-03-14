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
      <div className="h-40 rounded-lg border border-zinc-800 bg-black/20 flex items-center justify-center text-xs text-zinc-500">
        Advert space
      </div>
    );
  }

  const media = advert.media?.[0];

  return (
    <div className="rounded-lg border border-zinc-800 overflow-hidden bg-black/40">
      <div className="px-3 pt-3 text-[11px] uppercase tracking-wide text-zinc-400">
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
            className="w-full h-40 object-cover mt-2"
          />
        ) : media?.url ? (
          <img
            src={media.url}
            alt={advert.title || "Advert"}
            className="w-full h-40 object-cover mt-2"
          />
        ) : null}
      </button>

      <div className="p-3">
        <div className="text-sm font-medium line-clamp-2">
          {advert.title || "Advert"}
        </div>
        <button
          onClick={() => onClickAction?.(advert)}
          className="mt-3 w-full rounded-md bg-white text-black px-3 py-2 text-sm"
        >
          {advert.buttonLabel || "Learn more"}
        </button>
      </div>
    </div>
  );
}
