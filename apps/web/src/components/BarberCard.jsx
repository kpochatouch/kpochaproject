// apps/web/src/components/BarberCard.jsx
import { Link } from "react-router-dom";

/**
 * Branding is sourced from .env for flexibility.
 * Vite: VITE_APP_LOGO_URL=https://your-cdn/...png
 */
const APP_LOGO_URL = import.meta.env.VITE_APP_LOGO_URL || "";

/* ------------------------------ Helpers ------------------------------ */
/**
 * The backend now sends services as an array of objects like:
 * { name: "Haircut", price: 15000, ... }
 * but we'll keep the fallback for strings just in case.
 */
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
        className="w-20 h-20 rounded-full border-2 border-zinc-700 object-cover shadow-lg cursor-pointer"
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
      className="w-20 h-20 rounded-full border-2 border-zinc-700 bg-zinc-900 flex items-center justify-center text-xl font-semibold"
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
  // backend now guarantees `id` in proToBarber
  const id = barber.id || barber._id || "";
  const name =
    barber.name ||
    [barber.firstName, barber.lastName].filter(Boolean).join(" ").trim() ||
    "Professional";

  const role = typeof barber.title === "string" ? barber.title.trim() : "";
  const availability = availabilityLabel(barber.availability);
  const verified = !!barber.verified;

  const lga = String(barber.lga || "").trim();
  const state = String(barber.state || "").trim();

  const services = toArrayServices(barber.services);
  const topThree = services.slice(0, 3);

  // If backend sent startingPrice, trust it. Otherwise derive from services.
  const startingPrice =
    typeof barber.startingPrice === "number" && barber.startingPrice >= 0
      ? barber.startingPrice
      : services.length
      ? Math.min(
          ...services
            .map((s) => Number(s.price) || 0)
            .filter((n) => Number.isFinite(n))
        )
      : 0;

  const bio = String(barber.bio || barber.description || "").trim();
  const photoUrl = barber.photoUrl || barber.avatarUrl || "";

// ======================= FIXED RATING LOGIC ===========================
const ratingCount = Number(barber.ratingCount || 0);

const rawRating =
  typeof barber.rating === "number"
    ? barber.rating
    : Number(
        barber?.metrics && typeof barber.metrics.avgRating !== "undefined"
          ? barber.metrics.avgRating
          : 0
      ) || 0;

// Only show rating if there are REAL reviews
const hasRealReviews = ratingCount > 0 && rawRating > 0;

const rating = hasRealReviews
  ? Math.max(0, Math.min(5, rawRating))
  : 0;

// Stars
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
      className="
        relative overflow-hidden rounded-2xl
        border border-zinc-800
        bg-[#0f1116]
        text-white
      "
      style={{
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.03) inset, 0 10px 30px rgba(0,0,0,0.45)",
      }}
    >
      {/* Dot decoration */}
      <svg
        className="absolute left-1/2 -translate-x-1/2 -top-1 h-16 w-24 opacity-30"
        viewBox="0 0 80 60"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="dots"
            x="0"
            y="0"
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="0.6" fill="#ff7a00" />
          </pattern>
        </defs>
        <path d="M0,0 L80,0 L40,60 Z" fill="url(#dots)" />
      </svg>

      {/* Logo from .env */}
      {APP_LOGO_URL && (
        <img
          src={APP_LOGO_URL}
          alt="Kpocha Touch"
          className="absolute right-4 top-3 h-9 w-9 rounded-full object-cover ring-1 ring-white/10 bg-white/10 p-0.5"
          loading="lazy"
        />
      )}

      {/* Top content */}
      <div className="flex gap-5 px-5 pt-5 pb-16">
        <div className="shrink-0">
          <Avatar url={photoUrl} seed={name} onClick={handleAvatarClick} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="leading-tight flex items-center gap-2">
            <div className="text-[20px] font-extrabold tracking-wide truncate">
              {name}
            </div>
            {/* small "From ₦..." if we have it */}
            {startingPrice > 0 && (
              <span className="text-[11px] text-gold bg-gold/10 px-2 py-0.5 rounded-full">
                From ₦{startingPrice.toLocaleString()}
              </span>
            )}
          </div>
          {role && <div className="text-sm text-zinc-400">{role}</div>}

          {/* Rating, location, etc. */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-300">
            {rating > 0 && (
              <span className="inline-flex items-center gap-0.5">
                {Array.from({ length: fullStars }).map((_, i) => (
                  <span
                    key={`f${i}`}
                    className={`text-yellow-400 kpo-star-anim ${
                      rating >= 4.6 ? "kpo-star-glow" : ""
                    }`}
                  >
                    ★
                  </span>
                ))}
                {Array.from({ length: emptyStars }).map((_, i) => (
                  <span key={`e${i}`} className="text-zinc-600 kpo-star-anim">
                    ★
                  </span>
                ))}
                <span className="ml-1 font-semibold">
                  {rating.toFixed(1)}
                </span>
                {ratingCount > 0 && (
                  <span className="text-zinc-500 ml-1">
                    ({ratingCount})
                  </span>
                )}
              </span>
            )}

            {(state || lga) && (
              <>
                {rating > 0 && <span className="h-3 w-px bg-zinc-700" />}
                <span className="truncate">
                  {[state, lga].filter(Boolean).join(", ")}
                </span>
              </>
            )}

            {availability && (
              <>
                <span className="h-3 w-px bg-zinc-700" />
                <span className="rounded-full px-2 py-0.5 bg-zinc-800 text-zinc-200">
                  {availability}
                </span>
              </>
            )}

            {verified && (
              <>
                <span className="h-3 w-px bg-zinc-700" />
                <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-emerald-300">
                  ✓ Verified
                </span>
              </>
            )}
          </div>

          {/* Top 3 services */}
          {!!topThree.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {topThree.map((s, i) => {
                const label = priceTag(s);
                const svcName = s?.name || "";
                return onBook && svcName ? (
                  <button
                    key={`${svcName}-${i}`}
                    type="button"
                    onClick={() => onBook(svcName)}
                    className="rounded-full border border-zinc-700 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-900"
                    title={`Book ${svcName}`}
                  >
                    {label}
                  </button>
                ) : (
                  <span
                    key={`${label}-${i}`}
                    className="rounded-full border border-zinc-700 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-200"
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          )}

          {bio && (
            <p className="mt-3 line-clamp-2 text-sm text-zinc-300">{bio}</p>
          )}
        </div>
      </div>

      {/* Gradient footer */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-16"
        style={{
          background:
            "linear-gradient(90deg, #ff7a00 0%, #ff3b3b 45%, #ff2d55 100%)",
          clipPath:
            "path('M0,0 C120,30 260,-5 360,12 C420,22 480,40 520,0 L520,64 L0,64 Z')",
        }}
        aria-hidden="true"
      />

      {/* Bottom action bar */}
      <div className="absolute inset-x-5 bottom-3 z-10 flex items-center justify-between">
        <Link
          to={id ? `/profile/${id}` : "#"}
          className="px-4 py-2 rounded-lg bg-black text-white font-bold text-sm shadow-md hover:opacity-90"
          onClick={(e) => !id && e.preventDefault()}
          title="View public profile"
        >
          View profile
        </Link>
        {onBook ? (
          <button
            onClick={() => onBook(null)}
            className="px-4 py-2 rounded-lg bg-black text-white font-bold text-sm shadow-md hover:opacity-90"
          >
            Book now
          </button>
        ) : (
          <Link
            to={id ? `/book/${id}` : "#"}
            className="px-4 py-2 rounded-lg bg-black text-white font-bold text-sm shadow-md hover:opacity-90"
            onClick={(e) => !id && e.preventDefault()}
          >
            Book now
          </Link>
        )}
      </div>
    </div>
  );
}
