// apps/web/src/components/BarberCard.jsx
import { useState } from "react";
import { Link } from "react-router-dom";

/**
 * BRANDING:
 * This must stay. Do NOT remove or make "optional" — app branding depends on it.
 * If later you want to swap it, change the URL here or move to env, but keep the slot.
 */
// Use .env variable instead of hard-coded link
const LOGO_URL = import.meta.env.VITE_APP_LOGO_URL || "";

/* ------------------------------ Helpers ------------------------------ */
function toArrayServices(svcs) {
  if (Array.isArray(svcs)) {
    return svcs
      .map((s) => (typeof s === "string" ? { name: s } : s))
      .filter((s) => s && s.name);
  }
  if (typeof svcs === "string") {
    return svcs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }
  return [];
}

function priceTag(s) {
  const name = s?.name || "Service";
  const price = s?.price;
  if (price == null || price === "" || Number.isNaN(Number(price))) return name;
  return `${name} ₦${Number(price).toLocaleString()}`;
}

/** Turn availability (string | object) into a short, safe label; empty string means “don’t render chip” */
function availabilityLabel(av) {
  if (!av) return "";
  if (typeof av === "string") {
    const t = av.trim();
    return t ? t : "";
  }
  if (typeof av === "object") {
    if (typeof av.status === "string" && av.status.trim()) return av.status.trim();
    const start = av.start ? String(av.start).trim() : "";
    const end = av.end ? String(av.end).trim() : "";
    if (start && end) return `Hours ${start}-${end}`;
    return "";
  }
  return "";
}

function Avatar({ url, seed, onClick }) {
  if (url) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-20 h-20 rounded-full border-2 border-zinc-700 overflow-hidden shadow-lg"
        title="Click to view photo"
      >
        <img src={url} alt="Profile" className="w-full h-full object-cover" loading="lazy" />
      </button>
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
    <div className="w-20 h-20 rounded-full border-2 border-zinc-700 bg-zinc-900 flex items-center justify-center text-xl font-semibold">
      {initials}
    </div>
  );
}

/* =======================================================================
   Card with bottom actions:
   - View now → opens drawer via onOpen(barber)
   - Book now → calls onBook(serviceName|null) OR links to /book/:id
   ======================================================================= */
export default function BarberCard({ barber = {}, onOpen, onBook }) {
  const [lightbox, setLightbox] = useState("");

  const id = barber.id || barber._id || "";
  const name =
    barber.name ||
    [barber.firstName, barber.lastName].filter(Boolean).join(" ").trim() ||
    "Professional";

  const role =
    (typeof barber.title === "string" && barber.title.trim()) ||
    "" /* neutral: no fake demo text */;

  const rating =
    typeof barber.rating === "number" && Number.isFinite(barber.rating)
      ? barber.rating
      : null;

  const availability = availabilityLabel(barber.availability);
  const verified = !!barber.verified;

  const lga = (barber.lga || "").toString().trim();
  const state = (barber.state || "").toString().trim();

  // prefer *real pro doc* fields
  const services = toArrayServices(
    barber.services ||
      barber.servicesDetailed ||
      (barber.professional && (barber.professional.services || barber.professional.servicesDetailed)) ||
      []
  );
  const topThree = services.slice(0, 3);

  const bio = (barber.bio || barber.description || "").toString().trim();

  // prefer image from pro -> identity -> plain avatar
  const photoUrl =
    barber.photoUrl ||
    barber.avatarUrl ||
    (barber.identity && (barber.identity.photoUrl || barber.identity.avatarUrl)) ||
    "";

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
      {/* KPOCHA TOUCH LOGO (DO NOT REMOVE) */}
      {LOGO_URL && (
        <img
          src={LOGO_URL}
          alt="Kpocha Touch"
          className="absolute right-4 top-3 h-9 w-9 rounded-full object-cover ring-1 ring-white/10 bg-white/10 p-0.5"
          loading="lazy"
        />
      )}

      {/* Top content */}
      <div className="flex gap-5 px-5 pt-5 pb-16">
        <div className="shrink-0">
          <Avatar url={photoUrl} seed={name} onClick={() => photoUrl && setLightbox(photoUrl)} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="leading-tight">
            <div className="text-[20px] font-extrabold tracking-wide truncate">
              {name}
            </div>
            {role ? <div className="text-sm text-zinc-400">{role}</div> : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-300">
            {rating != null && (
              <span className="inline-flex items-center gap-1">
                <span className="text-amber-300">★</span>
                <span className="font-semibold">{rating.toFixed(1)}</span>
              </span>
            )}

            {(state || lga) && (
              <>
                {rating != null && <span className="h-3 w-px bg-zinc-700" />}
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

          {/* Top services */}
          {!!topThree.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {topThree.map((s, i) => {
                const label = priceTag(s);
                const svcName = s?.name || "";
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

          {bio && <p className="mt-3 line-clamp-2 text-sm text-zinc-300">{bio}</p>}
        </div>
      </div>

      {/* Gradient footer (keep visual) */}
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

      {/* Avatar lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setLightbox("")}
        >
          <div className="max-w-2xl max-h-[85vh] rounded-xl overflow-hidden border border-zinc-700">
            <img src={lightbox} alt="Pro photo" className="block max-h-[85vh] object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * COMMENTS (BarberCard.jsx)
 * - Kept the Kpocha Touch logo hard-coded on top-right.
 * - Avatar is now clickable → expands in lightbox.
 * - We now prefer real pro fields (services, identity.photoUrl) so public list shows real data.
 * - Book + View still work the same with the drawer.
 */
