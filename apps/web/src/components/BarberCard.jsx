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
        className="w-14 h-14 rounded-full object-cover shadow cursor-pointer"
        style={{ border: "1px solid var(--app-border)" }}
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
      className="w-14 h-14 rounded-full flex items-center justify-center text-sm font-semibold cursor-pointer"
      style={{
        border: "1px solid var(--app-border)",
        backgroundColor: "var(--app-surface-2)",
        color: "var(--app-text)",
      }}
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
    <div
      className="group w-full rounded-2xl border px-4 py-3 transition"
      style={{
        borderColor: "var(--app-border)",
        backgroundColor: "var(--app-surface)",
        color: "var(--app-text)",
      }}
    >
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
                  <span className="shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium text-black bg-gold">
                    From ₦{startingPrice.toLocaleString()}
                  </span>
                )}
              </div>

              {rating > 0 && (
                <div
                  className="mt-1 flex items-center gap-1 text-xs"
                  style={{ color: "var(--app-text-soft)" }}
                >
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

              <div
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                style={{ color: "var(--app-text-soft)" }}
              >
                {(state || lga) && (
                  <span className="truncate">
                    {[state, lga].filter(Boolean).join(", ")}
                  </span>
                )}
                {availability && (
                  <>
                    {(state || lga) && (
                      <span style={{ color: "var(--app-text-soft)" }}>•</span>
                    )}
                    <span>{availability}</span>
                  </>
                )}
                {role && (
                  <>
                    {(state || lga || availability) && (
                      <span style={{ color: "var(--app-text-soft)" }}>•</span>
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
                    className="rounded-full px-3 py-1 text-[11px] hover:opacity-90"
                    style={{
                      border: "1px solid var(--app-border)",
                      backgroundColor: "var(--app-surface-2)",
                      color: "var(--app-text)",
                    }}
                    title={`Book ${svcName}`}
                  >
                    {label}
                  </button>
                ) : (
                  <span
                    key={`${label}-${i}`}
                    className="rounded-full px-3 py-1 text-[11px]"
                    style={{
                      border: "1px solid var(--app-border)",
                      backgroundColor: "var(--app-surface-2)",
                      color: "var(--app-text)",
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          )}

          {bio && (
            <p
              className="mt-2 line-clamp-2 text-sm"
              style={{ color: "var(--app-text-soft)" }}
            >
              {bio}
            </p>
          )}
        </div>

        <div className="shrink-0 flex items-start">
          <div className="flex flex-col gap-2">
            {onBook ? (
              <button
                type="button"
                onClick={() => onBook(null)}
                className="rounded-full px-4 py-2 text-[14px] font-semibold text-black bg-gold hover:opacity-90"
              >
                Book now
              </button>
            ) : (
              <Link
                to={id ? `/book/${id}` : "#"}
                className="rounded-full px-4 py-2 text-[14px] font-semibold text-black bg-gold hover:opacity-90 text-center"
                onClick={(e) => !id && e.preventDefault()}
              >
                Book now
              </Link>
            )}

            <Link
              to={id ? `/profile/${id}` : "#"}
              className="rounded-full px-4 py-2 text-[14px] font-semibold text-center hover:opacity-90"
              style={{
                color: "var(--app-text)",
                backgroundColor: "var(--app-surface-2)",
                border: "1px solid var(--app-border)",
              }}
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
