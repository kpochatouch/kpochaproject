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
    <article className="rounded-xl border border-zinc-800 bg-black/40 overflow-hidden">
      <div className="px-4 pt-3">
        <div className="text-xs uppercase tracking-wide text-zinc-400">
          Sponsored
        </div>
      </div>

      {media?.type === "video" ? (
        <video
          src={media?.url}
          controls
          className="w-full max-h-[520px] object-cover mt-3"
          onClick={() => onClickAction?.(advert)}
        />
      ) : media?.url ? (
        <img
          src={media.url}
          alt={advert.title || "Advert"}
          className="w-full max-h-[520px] object-cover mt-3"
          onClick={() => onClickAction?.(advert)}
        />
      ) : null}

      <div className="p-4">
        <div className="font-semibold">{advert.title || "Advert"}</div>
        <div className="text-sm text-zinc-400 mt-1">{advert.text || ""}</div>

        <button
          onClick={() => onClickAction?.(advert)}
          className="mt-4 rounded-lg bg-white text-black px-4 py-2 text-sm font-medium"
        >
          {advert.buttonLabel || "Learn more"}
        </button>
      </div>
    </article>
  );
}
