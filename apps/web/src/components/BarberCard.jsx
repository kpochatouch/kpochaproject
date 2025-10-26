// apps/web/src/components/BarberCard.jsx
import { Link } from "react-router-dom";

/** Kpocha Touch logo (top-right) */
const LOGO_URL =
  "https://res.cloudinary.com/dupex2y3k/image/upload/v1760302703/kpocha-touch-logo_srzbiu.jpg";

/* ------------------------------ Helpers ------------------------------ */
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
  return Number.isFinite(Number(price)) ? `${name} ₦${Number(price).toLocaleString()}` : name;
}

/** Turn availability (string | object) into a short, safe label for UI */
function availabilityLabel(av) {
  if (!av) return "Available";
  if (typeof av === "string") return av;
  // object shape from server: { days, start, end, emergency, ... } or { status }
  if (typeof av === "object") {
    if (typeof av.status === "string" && av.status.trim()) return av.status;
    const start = av.start ? String(av.start) : null;
    const end = av.end ? String(av.end) : null;
    if (start && end) return `Hours ${start}-${end}`;
    return "Available";
  }
  return "Available";
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

/* =======================================================================
   Card with bottom actions:
   - View (left) — opens drawer
   - Book now (right) — calls onBook(service?) so Browse can carry state/LGA/service forward
   ======================================================================= */
export default function BarberCard({ barber, onOpen, onBook }) {
  const id = barber?.id || barber?._id;
  const name = barber?.name || "Professional";

  const role =
    barber?.title ||
    (Array.isArray(barber?.services) && barber.services[0]?.name) ||
    (typeof barber?.services === "string" ? barber.services.split(",")[0]?.trim() : "") ||
    "Art Director";

  const rating = typeof barber?.rating === "number" ? barber.rating.toFixed(1) : "4.8";

  // 🛡️ Never render raw objects into JSX — convert to a label first
  const availability = availabilityLabel(barber?.availability);

  const verified = !!barber?.verified;

  const lga = barber?.lga || "UNSPECIFIED";
  const state = barber?.state || "";

  const services = toArrayServices(barber?.services);
  const topThree = services.slice(0, 3);

  const bio =
    barber?.bio || barber?.description || "Premium grooming & creative styling tailored to you.";

  const photoUrl = barber?.photoUrl || barber?.avatarUrl || "";

  return (
    <div
      className="
        relative overflow-hidden rounded-2xl
        border border-zinc-800
        bg-[#0f1116]
        text-white
      "
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 10px 30px rgba(0,0,0,0.45)",
      }}
    >
      {/* Subtle dot-decoration */}
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
          <div className="leading-tight">
            <div className="text-zinc-200 text-[15px]">
              {name.split(" ").slice(0, -1).join(" ") || name}
            </div>
            <div className="text-[24px] font-extrabold tracking-wide">
              {name.split(" ").length > 1 ? name.split(" ").slice(-1) : ""}
            </div>
            <div className="text-sm text-zinc-400">{role}</div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-300">
            <span className="inline-flex items-center gap-1">
              <span className="text-amber-300">★</span>
              <span className="font-semibold">{rating}</span>
            </span>
            <span className="h-3 w-px bg-zinc-700" />
            <span className="truncate">{state ? `${state}, ${lga}` : lga}</span>
            <span className="h-3 w-px bg-zinc-700" />
            <span
              className={`rounded-full px-2 py-0.5 ${
                availability === "Available" ? "bg-green-900/40 text-green-300" : "bg-zinc-800 text-zinc-300"
              }`}
            >
              {availability}
            </span>
            {verified && (
              <>
                <span className="h-3 w-px bg-zinc-700" />
                <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-emerald-300">✓ Verified</span>
              </>
            )}
          </div>

          {/* Top services — clickable to preselect on Book page if onBook exists */}
          {!!topThree.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {topThree.map((s, i) => {
                const label = priceTag(s);
                const svcName = typeof s === "string" ? s : s?.name || "";
                if (onBook && svcName) {
                  return (
                    <button
                      key={`${svcName}-${i}`}
                      type="button"
                      onClick={() => onBook(svcName)}
                      className="rounded-full border border-zinc-700 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-900"
                      title={`Book "${svcName}"`}
                    >
                      {label}
                    </button>
                  );
                }
                return (
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

          <p className="mt-3 line-clamp-2 text-sm text-zinc-300">{bio}</p>
        </div>
      </div>

      {/* Gradient footer */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-16"
        style={{
          background: "linear-gradient(90deg, #ff7a00 0%, #ff3b3b 45%, #ff2d55 100%)",
          clipPath: "path('M0,0 C120,30 260,-5 360,12 C420,22 480,40 520,0 L520,64 L0,64 Z')",
        }}
      />

      {/* Bottom action bar */}
      <div className="absolute inset-x-5 bottom-3 z-10 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onOpen?.(barber)}
          className="px-4 py-2 rounded-lg bg-black text-white font-bold text-sm shadow-md hover:opacity-90"
          title="View full profile"
        >
          View now
        </button>
        {onBook ? (
          <button
            type="button"
            onClick={() => onBook(null)}
            className="px-4 py-2 rounded-lg bg-black text-white font-bold text-sm shadow-md hover:opacity-90"
          >
            Book now
          </button>
        ) : (
          <Link
            to={id ? `/book/${id}` : "#"}
            className="px-4 py-2 rounded-lg bg-black text-white font-bold text-sm shadow-md hover:opacity-90"
            aria-disabled={!id}
            onClick={(e) => {
              if (!id) e.preventDefault();
            }}
          >
            Book now
          </Link>
        )}
      </div>
    </div>
  );
}
