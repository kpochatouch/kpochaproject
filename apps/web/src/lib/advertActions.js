// apps/web/src/lib/advertActions.js
import { api } from "./api";

export async function trackAdvertClick(advertId) {
  if (!advertId) return;
  api.post(`/api/adverts/${advertId}/click`).catch(() => {});
}

export function openAdvertTarget({ advert, navigate }) {
  if (!advert) return;

  const value = advert.actionValue || "";
  const type = advert.actionType || "";

  if (type === "external_url") {
    window.open(value, "_blank", "noopener,noreferrer");
    return;
  }

  if (type === "profile") {
    navigate(`/profile/${encodeURIComponent(value)}`);
    return;
  }

  if (type === "booking") {
    navigate(`/book/${encodeURIComponent(value)}`);
    return;
  }

  if (type === "chat") {
    navigate(`/inbox?chat=${encodeURIComponent(value)}`);
    return;
  }

  if (type === "post") {
    navigate(`/browse?post=${encodeURIComponent(value)}`);
  }
}

export async function handleAdvertClick({ advert, navigate }) {
  if (!advert?._id) return;
  trackAdvertClick(advert._id);
  openAdvertTarget({ advert, navigate });
}
