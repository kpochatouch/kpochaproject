// apps/web/src/components/ProDrawer.jsx
import { Link } from "react-router-dom";

const LOGO_URL =
  "https://res.cloudinary.com/dupex2y3k/image/upload/v1760302703/kpocha-touch-logo_srzbiu.jpg";

/* ------------------------------ helpers ------------------------------ */
function money(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  return `₦${Number(n).toLocaleString()}`;
}
function toArray(x) {
  if (Array.isArray(x)) return x;
  if (typeof x === "string") {
    return x.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
function svcRows(services) {
  const arr = toArray(services);
  return arr.map((s, i) => {
    if (typeof s === "string") {
      return { key: `${i}-${s}`, name: s, price: null, durationMin: null };
    }
    return {
      key: s._id || s.id || `${i}-${s?.name || "Service"}`,
      name: s?.name || "Service",
      price: s?.price ?? null,
      durationMin: s?.durationMin ?? null,
      desc: s?.desc,
    };
  });
}

/* ------------------------------ component ------------------------------ */
export default function ProDrawer({ open, pro, onClose }) {
  if (!open || !pro) return null;

  const verified =
    !!pro.verified || (Array.isArray(pro.badges) && pro.badges.includes("verified"));
  const photos = toArray(pro.photos);
  const services = svcRows(pro.services);
  const rating = typeof pro.rating === "number" ? pro.rating.toFixed(1) : "5.0";

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />

      {/* Panel */}
      <div className="absolute right-0 top-0 h-full w-full sm:w-[560px] bg-[#0f1116] text-white border-l border-zinc-800 shadow-2xl overflow-hidden">
        {/* Decorative creamy-pinky rail */}
        <LeftCarvedRail />

        {/* Header */}
        <div className="relative flex items-center justify-between pl-24 pr-4 sm:pl-28 py-4 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-semibold">{pro.name || "Professional"}</h3>
              {verified && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 border border-emerald-800">
                  Verified
                </span>
              )}
            </div>
            <div className="text-sm text-zinc-400">{pro.lga || "—"} • ⭐ {rating}</div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white px-2 py-1 rounded"
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="relative h-[calc(100%-60px)] overflow-y-auto px-4 pl-24 sm:pl-28 pb-6 space-y-6">
          {(pro.bio || pro.description) && (
            <section>
              <h4 className="font-semibold mb-2">About</h4>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">
                {pro.bio || pro.description}
              </p>
            </section>
          )}

          <section>
            <h4 className="font-semibold mb-2">Services &amp; Pricing</h4>
            {services.length ? (
              <div className="overflow-hidden rounded-lg border border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-900/50 text-zinc-400">
                    <tr>
                      <th className="text-left px-3 py-2">Service</th>
                      <th className="text-left px-3 py-2">Price</th>
                      <th className="text-left px-3 py-2">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((s) => (
                      <tr key={s.key} className="border-t border-zinc-800">
                        <td className="px-3 py-2">
                          <div className="font-medium text-zinc-100">{s.name}</div>
                          {s.desc && <div className="text-xs text-zinc-400">{s.desc}</div>}
                        </td>
                        <td className="px-3 py-2">{money(s.price)}</td>
                        <td className="px-3 py-2">{s.durationMin ? `${s.durationMin} min` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-zinc-400">This pro has not listed services yet.</div>
            )}
          </section>

          {Array.isArray(pro.badges) && pro.badges.length > 0 && (
            <section>
              <h4 className="font-semibold mb-2">Badges</h4>
              <div className="flex flex-wrap gap-2">
                {pro.badges.map((b, i) => (
                  <span key={i} className="text-xs px-2 py-1 rounded-full border border-zinc-700 text-zinc-300">
                    {b}
                  </span>
                ))}
              </div>
            </section>
          )}

          {photos.length > 0 && (
            <section>
              <h4 className="font-semibold mb-2">Gallery</h4>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`Photo ${i + 1}`}
                    className="w-full h-28 object-cover rounded-md border border-zinc-800"
                    loading="lazy"
                  />
                ))}
              </div>
            </section>
          )}

          <div className="pt-2 flex gap-2">
            <Link
              to={`/book/${pro.id || pro._id}`}
              className="inline-block rounded-lg bg-black text-white px-4 py-2 font-bold shadow-md hover:opacity-90"
            >
              Book now
            </Link>
            <button className="rounded-lg border border-zinc-700 px-4 py-2 hover:bg-zinc-900" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes kt-marquee-y {
          0% { transform: translateY(100%); }
          100% { transform: translateY(-100%); }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------ Carved Rail ------------------------------ */
function LeftCarvedRail() {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 w-20 sm:w-24">
      {/* Creamy-pinky base with carved edge (full height) */}
      <svg
        className="absolute inset-y-0 left-0 h-full w-full"
        viewBox="0 0 96 720"
        preserveAspectRatio="none"
      >
        <defs>
          {/* Cream→Pinky vertical gradient */}
          <linearGradient id="ktRailGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFE9DC" />
            <stop offset="100%" stopColor="#FFC7D6" />
          </linearGradient>

          {/* Soft dotted accent (subtle) */}
          <pattern id="ktDots" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.6" fill="#ff7a00" />
          </pattern>
        </defs>

        {/* Outer layer */}
        <path
          d="
            M0,0
            L76,0
            C62,100 62,180 76,260
            C88,330 88,390 76,460
            C62,540 62,620 76,720
            L0,720 Z
          "
          fill="url(#ktRailGrad)"
        />

        {/* Subtle dot triangle high up */}
        <path d="M12,28 L88,28 L50,88 Z" fill="url(#ktDots)" opacity="0.22" />
      </svg>

      {/* Inner inset to create the “double layer” edge */}
      <svg
        className="absolute inset-y-0 left-0 h-full w-full"
        viewBox="0 0 96 720"
        preserveAspectRatio="none"
      >
        <path
          d="
            M0,0
            L64,0
            C54,100 54,180 64,260
            C72,330 72,390 64,460
            C54,540 54,620 64,720
            L0,720 Z
          "
          fill="rgba(255,255,255,0.25)"
          style={{ mixBlendMode: "overlay" }}
        />
      </svg>

      {/* Gradient sweep near bottom (ties to card theme) */}
      <div
        className="absolute left-0 right-0 bottom-10 h-12"
        style={{
          background:
            "linear-gradient(90deg, #ff9500 0%, #ff3b3b 50%, #ff2d55 100%)",
          clipPath: "path('M0,0 C40,10 70,0 96,8 L96,48 L0,48 Z')",
          opacity: 0.95,
        }}
      />

      {/* Round logo */}
      <img
        src={LOGO_URL}
        alt="Kpocha Touch"
        className="absolute top-3 left-3 h-10 w-10 sm:h-12 sm:w-12 rounded-full object-cover ring-1 ring-black/10 bg-white p-0.5 z-10"
        loading="lazy"
      />

      {/* Vertical scrolling text — pure black, fades near logo so it looks like it disappears into it */}
      <div className="absolute left-0 right-0 top-20 bottom-24 overflow-hidden">
        <div
          className="absolute left-1/2 -translate-x-1/2 h-[220%] w-[calc(100%-18px)] text-[11px] sm:text-xs font-medium"
          style={{
            color: "#000000",
            writingMode: "vertical-rl",
            animation: "kt-marquee-y 10s linear infinite",
            whiteSpace: "nowrap",
            // mask so the text "disappears" into the logo region + soft fade at very top
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0px, transparent 56px, black 80px), radial-gradient(40px 40px at 50% 0px, transparent 0 22px, black 30px)",
            maskImage:
              "linear-gradient(to bottom, transparent 0px, transparent 56px, black 80px), radial-gradient(40px 40px at 50% 0px, transparent 0 22px, black 30px)",
            WebkitMaskComposite: "destination-over",
            maskComposite: "exclude",
          }}
          aria-hidden
        >
          {/* Repeat line several times for a seamless loop */}
          <span>Connecting You To Top Barbers and Stylists • </span>
          <span>Connecting You To Top Barbers and Stylists • </span>
          <span>Connecting You To Top Barbers and Stylists • </span>
          <span>Connecting You To Top Barbers and Stylists • </span>
        </div>
      </div>
    </div>
  );
}
