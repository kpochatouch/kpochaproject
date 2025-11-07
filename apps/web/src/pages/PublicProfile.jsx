// apps/web/src/pages/PublicProfile.jsx
import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";

const APP_LOGO_URL = import.meta.env.VITE_APP_LOGO_URL || "";

function money(n) {
  if (n == null || n === "" || Number.isNaN(Number(n))) return null;
  return "₦" + Number(n).toLocaleString();
}

export default function PublicProfile() {
  const { id } = useParams(); // /profile/:id
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        // THIS is the unified source
        const { data } = await api.get(`/api/barbers/${id}`);
        if (!alive) return;
        setPro(data || null);
        if (!data) setErr("Profile not found.");
      } catch (e) {
        if (alive) setErr("Failed to load profile.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-10 text-zinc-200">
        Loading profile…
      </div>
    );
  }

  if (err) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-10 text-zinc-200">
        <p className="mb-3">{err}</p>
        <button
          onClick={() => navigate(-1)}
          className="px-3 py-1.5 rounded bg-zinc-800"
        >
          Go back
        </button>
      </div>
    );
  }

  if (!pro) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-10 text-zinc-200">
        Profile not found.
      </div>
    );
  }

  // unwrap safe fields from /api/barbers/:id
  const name = pro.name || "Professional";
  const location = [pro.state, pro.lga].filter(Boolean).join(", ");
  const avatar =
    pro.photoUrl ||
    (Array.isArray(pro.gallery) && pro.gallery.length
      ? pro.gallery[0]
      : "");
  const services = Array.isArray(pro.services) ? pro.services : [];
  const rating =
    typeof pro.rating === "number" ? Math.max(0, Math.min(5, pro.rating)) : 0;
  const fullStars =
    pro?.ratingStars?.full != null
      ? pro.ratingStars.full
      : Math.round(rating);
  const badges = Array.isArray(pro.badges) ? pro.badges : [];
  const gallery = Array.isArray(pro.gallery) ? pro.gallery : [];

  return (
    <div className="min-h-screen bg-[#0b0c10] text-white">
      {/* cover / header */}
      <div className="relative bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 h-44">
        {APP_LOGO_URL && (
          <img
            src={APP_LOGO_URL}
            alt="logo"
            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/5 p-1 object-cover"
          />
        )}
      </div>

      <div className="max-w-6xl mx-auto px-4 -mt-16">
        <div className="flex gap-6 items-end">
          <div className="w-32 h-32 rounded-full border-4 border-[#0b0c10] bg-zinc-900 overflow-hidden shrink-0">
            {avatar ? (
              <img
                src={avatar}
                alt={name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl">
                {name.slice(0, 1)}
              </div>
            )}
          </div>
          <div className="flex-1 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{name}</h1>
              {badges.map((b, i) => (
                <span
                  key={i}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-200 border border-emerald-700"
                >
                  {b}
                </span>
              ))}
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              {location || "Nigeria"}
            </p>
            {rating > 0 && (
              <div className="flex items-center gap-1 mt-2 text-sm">
                {Array.from({ length: fullStars }).map((_, i) => (
                  <span key={i} className="text-yellow-400">
                    ★
                  </span>
                ))}
                {Array.from({ length: 5 - fullStars }).map((_, i) => (
                  <span key={i} className="text-zinc-600">
                    ★
                  </span>
                ))}
                <span className="text-zinc-300 ml-1">{rating.toFixed(1)}</span>
              </div>
            )}
          </div>
          <div className="pb-3 flex gap-2">
            <Link
              to={`/book/${pro.id}`}
              className="px-4 py-2 bg-gold text-black font-semibold rounded-lg hover:opacity-90"
            >
              Book now
            </Link>
            {/* contact is NOT shown publicly – user must book */}
            <button
              className="px-4 py-2 border border-zinc-700 rounded-lg text-sm text-zinc-200"
              title="Contact details appear after booking"
              disabled
            >
              Contact via booking
            </button>
          </div>
        </div>
      </div>

      {/* body */}
      <div className="max-w-6xl mx-auto px-4 mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 pb-10">
        {/* left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* About */}
          {(pro.bio || pro.description) && (
            <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
              <h2 className="text-lg font-semibold mb-2">About</h2>
              <p className="text-sm text-zinc-200 whitespace-pre-wrap">
                {pro.bio || pro.description}
              </p>
            </section>
          )}

          {/* Services */}
          <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Services</h2>
              <span className="text-xs text-zinc-500">
                Click a service during booking
              </span>
            </div>
            {services.length ? (
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map((svc, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
                  >
                    <div className="font-medium">{svc.name}</div>
                    {money(svc.price) && (
                      <div className="text-sm text-zinc-200 mt-1">
                        {money(svc.price)}
                      </div>
                    )}
                    {svc.description && (
                      <div className="text-xs text-zinc-400 mt-1">
                        {svc.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">
                This professional has not listed services yet.
              </p>
            )}
          </section>

          {/* Gallery */}
          <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
            <h2 className="text-lg font-semibold mb-3">Gallery</h2>
            {gallery.length ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {gallery.map((src, i) => (
                  <button
                    key={i}
                    onClick={() => window.open(src, "_blank")}
                    className="block rounded-lg overflow-hidden border border-zinc-800"
                  >
                    <img
                      src={src}
                      alt=""
                      className="w-full h-40 object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">No photos yet.</p>
            )}
          </section>
        </div>

        {/* right column */}
        <div className="space-y-6">
          <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
            <h2 className="text-lg font-semibold mb-2">Booking</h2>
            <p className="text-sm text-zinc-400 mb-3">
              To view contact details, make a booking. We hide private contact
              from the public to keep your pros & clients safe.
            </p>
            <Link
              to={`/book/${pro.id}`}
              className="inline-block px-4 py-2 bg-gold text-black font-semibold rounded-lg hover:opacity-90"
            >
              Book this pro →
            </Link>
          </section>

          <section className="rounded-lg border border-zinc-800 bg-black/40 p-4">
            <h2 className="text-lg font-semibold mb-2">Location</h2>
            <p className="text-sm text-zinc-200">{location || "Nigeria"}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
