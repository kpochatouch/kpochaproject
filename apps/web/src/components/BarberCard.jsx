// apps/web/src/components/BarberCard.jsx
import { Link } from "react-router-dom";
import DisplayName from "./DisplayName.jsx";

/**
 * Branding is sourced from .env for flexibility.
 * Vite: VITE_APP_LOGO_URL=https://your-cdn/...png
 */
const APP_LOGO_URL = import.meta.env.VITE_APP_LOGO_URL || "/logo-kpocha.png";

/* ------------------------------ Helpers ------------------------------ */
function toArrayServices(svcs) {
  if (Array.isArray(svcs)) {
    return svcs
      .map((s) => (typeof s === "string" ? { name: s, price: 0 } : s))
      .filter((s) => s && s.name);
  }

  if (typeof svcs === "string") {
    return svcs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name, price: 0 }));
  }

  return [];
}

function priceTag(s) {
  const name = s?.name || "Service";
  const raw = s?.price;
  const priceNum = Number(raw);
  if (!Number.isFinite(priceNum) || priceNum <= 0) return name;
  return `${name} ₦${priceNum.toLocaleString()}`;
}

function availabilityLabel(av) {
  if (!av) return "";
  if (typeof av === "string") return av.trim();
  if (typeof av === "object") {
    if (av.status) return String(av.status).trim();
    if (av.start && av.end) return `Hours ${av.start}-${av.end}`;
  }
  return "";
}

function Avatar({ url, seed, onClick }) {
  if (url) {
    return (
      <img
        src={url}
        alt="Profile"
        className="w-14 h-14 rounded-full border border-zinc-700 object-cover shadow cursor-pointer"
        onClick={onClick}
      />
    );
  }

  const initials =
    (seed || "")
      .toString()
      .split("@")[0]
      .split(/[.\-_ ]+/)
      .slice(0, 2)
      .map((s) => s?.[0]?.toUpperCase())
      .join("") || "PR";

  return (
    <div
      className="w-14 h-14 rounded-full border border-zinc-700 bg-zinc-900 flex items-center justify-center text-sm font-semibold cursor-pointer"
      onClick={onClick}
    >
      {initials}
    </div>
  );
}

/* ===================================================================== */
/* The actual card shown in the list                                     */
/* ===================================================================== */
export default function BarberCard({ barber = {}, onOpen, onBook }) {
  const id = barber.id || barber._id || barber.ownerUid || "";

  const name =
    barber.name ||
    [barber.firstName, barber.lastName].filter(Boolean).join(" ").trim() ||
    "Professional";

  const role = typeof barber.title === "string" ? barber.title.trim() : "";
  const availability = availabilityLabel(barber.availability);

  const verifiedBadgeInList = Array.isArray(barber.badges)
    ? barber.badges.some((b) => {
        const value = typeof b === "string" ? b : b?.kind || b?.label || "";
        return String(value).toLowerCase() === "verified";
      })
    : false;

  const verified =
    Boolean(barber.verified) ||
    Boolean(barber.isVerified) ||
    Boolean(barber.identityVerified) ||
    verifiedBadgeInList ||
    String(barber.verificationStatus || "").toLowerCase() === "verified";

  const lga = String(barber.lga || "").trim();
  const state = String(barber.state || "").trim();
  const services = toArrayServices(barber.services);

  const startingPrice =
    typeof barber.startingPrice === "number" && barber.startingPrice >= 0
      ? barber.startingPrice
      : services.length
      ? Math.min(
          ...services
            .map((s) => Number(s.price) || 0)
            .filter((n) => Number.isFinite(n)),
        )
      : 0;

  const bio = String(barber.bio || barber.description || "").trim();
  const photoUrl = barber.photoUrl || barber.avatarUrl || "";

  const ratingCount = Number(barber.ratingCount || 0);

  const rawRating =
    typeof barber.rating === "number"
      ? barber.rating
      : Number(
          barber?.metrics && typeof barber.metrics.avgRating !== "undefined"
            ? barber.metrics.avgRating
            : 0,
        ) || 0;

  const hasRealReviews = ratingCount > 0 && rawRating > 0;
  const rating = hasRealReviews ? Math.max(0, Math.min(5, rawRating)) : 0;

  const fullStars =
    hasRealReviews && Number.isFinite(Number(barber?.ratingStars?.full))
      ? Math.max(0, Math.min(5, Number(barber.ratingStars.full)))
      : hasRealReviews
      ? Math.max(0, Math.min(5, Math.round(rating)))
      : 0;

  const emptyStars = 5 - fullStars;

  function handleAvatarClick() {
    onOpen?.(barber);
  }

  return (
    <div className="group w-full rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 text-white hover:bg-zinc-900/50 transition">
      <div className="flex items-stretch gap-3">
        <div className="shrink-0 self-start">
          <Avatar url={photoUrl} seed={name} onClick={handleAvatarClick} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <div className="text-[15px] font-semibold leading-tight truncate">
                  <DisplayName
                    name={name}
                    verified={verified}
                    badgeClassName="w-4 h-4"
                  />
                </div>

                {startingPrice > 0 && (
                  <span className="shrink-0 inline-flex items-center rounded-full border border-gold/20 bg-gold/10 px-2 py-0.5 text-[11px] text-gold">
                    From ₦{startingPrice.toLocaleString()}
                  </span>
                )}
              </div>

              {rating > 0 && (
                <div className="mt-1 flex items-center gap-1 text-xs text-zinc-300">
                  <span className="inline-flex items-center gap-0.5">
                    {Array.from({ length: fullStars }).map((_, i) => (
                      <span key={`f${i}`} className="text-yellow-400">
                        ★
                      </span>
                    ))}
                    {Array.from({ length: emptyStars }).map((_, i) => (
                      <span key={`e${i}`} className="text-zinc-600">
                        ★
                      </span>
                    ))}
                  </span>
                  <span className="font-medium">{rating.toFixed(1)}</span>
                  {ratingCount > 0 && (
                    <span className="text-zinc-500">({ratingCount})</span>
                  )}
                </div>
              )}

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                {(state || lga) && (
                  <span className="truncate">
                    {[state, lga].filter(Boolean).join(", ")}
                  </span>
                )}
                {availability && (
                  <>
                    {(state || lga) && <span className="text-zinc-600">•</span>}
                    <span>{availability}</span>
                  </>
                )}
                {role && (
                  <>
                    {(state || lga || availability) && (
                      <span className="text-zinc-600">•</span>
                    )}
                    <span>{role}</span>
                  </>
                )}
              </div>
            </div>

            {APP_LOGO_URL ? (
              <img
                src={APP_LOGO_URL}
                alt="Kpocha Touch"
                className="w-8 h-8 rounded-full object-cover border border-gold/20 bg-black/30 shrink-0"
                loading="lazy"
              />
            ) : null}
          </div>

          {!!services.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {services.map((s, i) => {
                const label = priceTag(s);
                const svcName = s?.name || "";

                return onBook && svcName ? (
                  <button
                    key={`${svcName}-${i}`}
                    type="button"
                    onClick={() => onBook(svcName)}
                    className="rounded-full border border-zinc-700 bg-zinc-950/70 px-3 py-1 text-[11px] text-zinc-200 hover:bg-zinc-900"
                    title={`Book ${svcName}`}
                  >
                    {label}
                  </button>
                ) : (
                  <span
                    key={`${label}-${i}`}
                    className="rounded-full border border-zinc-700 bg-zinc-950/70 px-3 py-1 text-[11px] text-zinc-200"
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          )}

          {bio && (
            <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{bio}</p>
          )}
        </div>

        <div className="shrink-0 flex">
          <div className="flex h-full min-w-[96px] flex-col overflow-hidden rounded-[999px] border border-zinc-700 bg-black/70">
            {onBook ? (
              <button
                type="button"
                onClick={() => onBook(null)}
                className="px-3 py-2 text-[13px] font-semibold text-black bg-gold hover:opacity-90 transition-transform duration-200 group-hover:scale-[1.04] group-focus-within:scale-[1.04]"
              >
                Book now
              </button>
            ) : (
              <Link
                to={id ? `/book/${id}` : "#"}
                className="px-3 py-2 text-center text-[13px] font-semibold text-black bg-gold hover:opacity-90 transition-transform duration-200 group-hover:scale-[1.04] group-focus-within:scale-[1.04]"
                onClick={(e) => !id && e.preventDefault()}
              >
                Book now
              </Link>
            )}

            <div className="h-px bg-zinc-700" />

            <Link
              to={id ? `/profile/${id}` : "#"}
              className="px-3 py-2 text-center text-[13px] font-semibold text-white bg-black hover:bg-zinc-900"
              onClick={(e) => !id && e.preventDefault()}
              title="View public profile"
            >
              View profile
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
