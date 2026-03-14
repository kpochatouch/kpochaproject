//apps/web/src/components/AdvertStoryCard.jsx
import { useEffect, useRef } from "react";
import { api } from "../lib/api";

export default function AdvertStoryCard({ advert, onClickAction }) {
  const seenRef = useRef(false);

  useEffect(() => {
    if (!advert?._id || seenRef.current) return;
    seenRef.current = true;
    api.post(`/api/adverts/${advert._id}/impression`).catch(() => {});
  }, [advert?._id]);

  if (!advert) return null;

  const media = advert.media?.[0];

  return (
    <div className="relative w-full h-full bg-black">
      {media?.type === "video" ? (
        <video
          src={media.url}
          className="w-full h-full object-cover"
          autoPlay
          muted
          loop
          playsInline
        />
      ) : media?.url ? (
        <img
          src={media.url}
          alt={advert.title || "Advert"}
          className="w-full h-full object-cover"
        />
      ) : null}

      <div className="absolute inset-x-0 top-0 p-4 bg-gradient-to-b from-black/70 to-transparent">
        <div className="text-xs uppercase tracking-wide text-white/80">
          Sponsored
        </div>
        <div className="mt-2 text-white font-semibold">{advert.title}</div>
        <div className="text-sm text-white/80 mt-1">{advert.text}</div>
      </div>

      <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
        <button
          onClick={() => onClickAction?.(advert)}
          className="w-full rounded-lg bg-white text-black px-4 py-3 text-sm font-medium"
        >
          {advert.buttonLabel || "Learn more"}
        </button>
      </div>
    </div>
  );
}
