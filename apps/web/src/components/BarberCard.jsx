// apps/web/src/components/BarberCard.jsx
import { Link } from "react-router-dom";

/** Kpocha Touch logo (top-right) */
const LOGO_URL =
  "https://res.cloudinary.com/dupex2y3k/image/upload/v1760302703/kpocha-touch-logo_srzbiu.jpg";

/** Helpers */
function toArrayServices(svcs) {
  if (Array.isArray(svcs)) {
    return svcs.map((s) => (typeof s === "string" ? s : s?.name)).filter(Boolean);
  }
  if (typeof svcs === "string") {
    return svcs.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
function priceTag(s) {
  const name = typeof s === "string" ? s : s?.name || "Service";
  const price = typeof s === "string" ? null : s?.price;
  return Number.isFinite(Number(price))
    ? `${name} ₦${Number(price).toLocaleString()}`
    : name;
}

function Avatar({ url, seed }) {
  if (url) {
    return (
      <img
        src={url}
        alt="Profile"
        className="w-20 h-20 rounded-full border-2 border-zinc-700 object-cover shadow-lg"
      />
    );
  }
  const initials =
    (seed || "?")
      .toString()
      .split("@")[0]
      .split(/[.\-_ ]+/)
      .slice(0, 2)
      .map((s) => s?.[0]?.toUpperCase())
      .join("") || "?";
  return (
    <div className="w-20 h-20 rounded-full border-2 border-zinc-700 bg-zinc-900 flex items-center justify-center text-xl font-semibold">
      {initials}
    </div>
  );
}

/**
 * PosterMyWall-inspired card with:
 * - round logo top-right
 * - larger avatar
 * - bottom action bar: View (left) & Book now (right), both #000 with white bold text
 * - NO phone number shown
 */
export default function BarberCard({ barber, onOpen }) {
  const id = barber?.id || barber?._id;
  const name = barber?.name || "Professional";
  const role =
    barber?.title ||
    (Array.isArray(barber?.services) && barber.services[0]?.name) ||
    (typeof barber?.services === "string"
      ? barber.services.split(",")[0]?.trim()
      : "") ||
    "Art Director";

  const rating =
    typeof barber?.rating === "number" ? barber.rating.toFixed(1) : "4.8";
  const availability = barber?.availability || "Available";
  const verified = !!barber?.verified;

  const lga = barber?.lga || "UNSPECIFIED";
  const state = barber?.state || "";

  const services = toArrayServices(barber?.services);
  const topThree = services.slice(0, 3);

  const bio =
    barber?.bio ||
    barber?.description ||
    "Premium grooming & creative styling tailored to you.";

  const photoUrl = barber?.photoUrl || barber?.avatarUrl || "";

  return (
    <div
      className="
        relative overflow-hidden rounded-2xl
        border border-zinc-800
        bg-[#0f1116]  /* deep slate like the sample */
        text-white
      "
      style={{
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.03) inset, 0 10px 30px rgba(0,0,0,0.45)",
      }}
    >
      {/* Subtle dot-decoration like the sample (top-center) */}
      <svg
        className="absolute left-1/2 -translate-x-1/2 -top-1 h-16 w-24 opacity-30"
        viewBox="0 0 80 60"
        fill="none"
      >
        <defs>
          <pattern id="dots" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.6" fill="#ff7a00" />
          </pattern>
        </defs>
        <path d="M0,0 L80,0 L40,60 Z" fill="url(#dots)" />
      </svg>

      {/* Round logo (top-right) */}
      <img
        src={LOGO_URL}
        alt="Kpocha Touch Logo"
        className="absolute right-4 top-3 h-9 w-9 rounded-full object-cover ring-1 ring-white/10 bg-white/10 p-0.5"
        loading="lazy"
      />

      {/* Top content */}
      <div className="flex gap-5 px-5 pt-5 pb-16">
        <div className="shrink-0">
          <Avatar url={photoUrl} seed={name} />
        </div>

        <div className="min-w-0 flex-1">
          {/* Name stack like sample (first name normal, last bold) */}
          <div className="leading-tight">
            <div className="text-zinc-200 text-[15px]">
              {name.split(" ").slice(0, -1).join(" ") || name}
            </div>
            <div className="text-[24px] font-extrabold tracking-wide">
              {name.split(" ").length > 1 ? name.split(" ").slice(-1) : ""}
            </div>
            <div className="text-sm text-zinc-400">{role}</div>
          </div>

          {/* Info row */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-300">
            <span className="inline-flex items-center gap-1">
              <span className="text-amber-300">★</span>
              <span className="font-semibold">{rating}</span>
            </span>
            <span className="h-3 w-px bg-zinc-700" />
            <span className="truncate">
              {state ? `${state}, ${lga}` : lga}
            </span>
            <span className="h-3 w-px bg-zinc-700" />
            <span
              className={`rounded-full px-2 py-0.5 ${
                availability === "Available"
                  ? "bg-green-900/40 text-green-300"
                  : "bg-zinc-800 text-zinc-300"
              }`}
            >
              {availability}
            </span>
            {verified && (
              <>
                <span className="h-3 w-px bg-zinc-700" />
                <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-emerald-300">
                  ✓ Verified
                </span>
              </>
            )}
          </div>

          {/* Services chips */}
          {!!topThree.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {topThree.map((s, i) => (
                <span
                  key={i}
                  className="rounded-full border border-zinc-700 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-200"
                >
                  {priceTag(s)}
                </span>
              ))}
            </div>
          )}

          {/* Bio */}
          <p className="mt-3 line-clamp-2 text-sm text-zinc-300">{bio}</p>
        </div>
      </div>

      {/* Orange→Pink sweeping footer (curved like the sample) */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-16"
        style={{
          background:
            "linear-gradient(90deg, #ff7a00 0%, #ff3b3b 45%, #ff2d55 100%)", // EDIT gradient here if needed
          clipPath:
            "path('M0,0 C120,30 260,-5 360,12 C420,22 480,40 520,0 L520,64 L0,64 Z')",
        }}
      />

      {/* Bottom action bar (above the sweep) */}
      <div className="absolute inset-x-5 bottom-3 z-10 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onOpen?.(barber)}
          className="px-4 py-2 rounded-lg bg-black text-white font-bold text-sm shadow-md hover:opacity-90"
          title="View full profile"
        >
          View now
        </button>
        <Link
          to={`/book/${id}`}
          className="px-4 py-2 rounded-lg bg-black text-white font-bold text-sm shadow-md hover:opacity-90"
        >
          Book now
        </Link>
      </div>
    </div>
  );
}
