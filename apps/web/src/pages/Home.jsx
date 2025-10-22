// apps/web/src/pages/Home.jsx
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../lib/api";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.6 },
};

export default function Home() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [hasClientProfile, setHasClientProfile] = useState(false);

  // --- measure header & ticker so hero is truly centered ---
  const [offsetPx, setOffsetPx] = useState(0);
  const tickerRef = useRef(null);

  useEffect(() => {
    const measure = () => {
      const headerEl =
        document.getElementById("app-header") ||
        document.querySelector("header");
      const headerH = headerEl?.offsetHeight ?? 72;
      const tickerH = tickerRef.current?.offsetHeight ?? 40;
      setOffsetPx(headerH + tickerH + 4);
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);

    const ro = new ResizeObserver(measure);
    const hdr = document.getElementById("app-header");
    if (hdr) ro.observe(hdr);
    if (tickerRef.current) ro.observe(tickerRef.current);

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      ro.disconnect();
    };
  }, []);

  // auth state
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/api/me");
        setMe(data);
      } catch {
        setMe(null);
      }
    })();
  }, []);

  // client profile check
  useEffect(() => {
    (async () => {
      if (!me?.uid) return setHasClientProfile(false);
      try {
        const { data } = await api.get("/api/profile/client/me");
        setHasClientProfile(!!data);
      } catch {
        setHasClientProfile(false);
      }
    })();
  }, [me?.uid]);

  const onFindProClick = () => {
    if (!me?.uid) return navigate("/signup");
    if (!hasClientProfile) return navigate("/register");
    return navigate("/browse");
  };

  // provide CSS var used in Tailwind calc()
  const heroStyle = useMemo(
    () => ({ "--hero-offset": `${offsetPx}px` }),
    [offsetPx]
  );

  return (
    <div className="bg-black text-white">
      {/* HERO */}
      <section
        className="relative gradient-hero overflow-hidden min-h-[calc(100svh-var(--hero-offset))] flex items-center justify-center text-center"
        style={heroStyle}
      >
        {/* Background video */}
        <video
          className="absolute inset-0 w-full h-full object-cover opacity-30"
          src="https://res.cloudinary.com/dupex2y3k/video/upload/v1760305198/kpocha-background-1_s2s9k9.mp4"
          autoPlay
          loop
          muted
          playsInline
        />
        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-black/80" />

        {/* Centered content */}
        <motion.div
          className="relative z-10 mx-auto max-w-5xl px-4 flex flex-col items-center justify-center gap-6"
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
        >
          <img
            src="https://res.cloudinary.com/dupex2y3k/image/upload/v1760302703/kpocha-touch-logo_srzbiu.jpg"
            alt="Kpocha Touch Logo"
            className="h-20 w-20 rounded-full border border-emerald-600 shadow-md shadow-emerald-500/30"
          />

          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight">
            Kpocha Touch <span className="text-gold">Unisex Salon</span>
          </h1>

          <p className="text-zinc-300 max-w-2xl mx-auto leading-relaxed">
            Connecting you to top barbers and stylists across{" "}
            <span className="text-gold">Nigeria</span>.<br />
            Book home or in-salon services in minutes.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              type="button"
              onClick={onFindProClick}
              className="rounded-xl bg-gold text-black px-6 py-3 font-semibold hover:bg-yellow-500 transition duration-300 shadow-lg shadow-yellow-500/30"
            >
              Find a Professional
            </button>

            <Link
              to="/become"
              className="rounded-xl border border-zinc-600 px-6 py-3 text-white font-semibold hover:bg-zinc-900 transition duration-300"
            >
              Become a Professional
            </Link>
          </div>
        </motion.div>

        {/* Ticker (measured) */}
        <motion.div
          ref={tickerRef}
          className="absolute bottom-0 left-0 w-full py-3 bg-black/40 border-t border-emerald-800 text-emerald-300 text-sm tracking-wide overflow-hidden whitespace-nowrap"
          animate={{ x: ["100%", "-100%"] }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        >
          ✨ Verified Pros • Secure Paystack Payments • 36 States &amp; FCT • Home &amp; Salon Services ✨
        </motion.div>
      </section>

      {/* GOLD BRAND STRIPE */}
      <section className="bg-gold text-black">
        <div className="max-w-6xl mx-auto px-4 py-8 text-center">
          <motion.p {...fadeUp} className="text-lg sm:text-xl font-semibold tracking-wide">
            Nigeria’s No. 1 grooming marketplace — trusted by clients and professionals nationwide.
          </motion.p>
        </div>
      </section>

      {/* WHO WE ARE */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <motion.h2 {...fadeUp} className="text-2xl sm:text-3xl font-bold text-center mb-4">
          Who We Are
        </motion.h2>
        <motion.p {...fadeUp} className="text-zinc-300 text-center max-w-3xl mx-auto">
          Kpocha Touch Unisex Salon is a booking platform that connects clients to{" "}
          <span className="text-gold">verified</span> barbers and stylists across Nigeria. Discover
          trusted pros, book instantly, pay securely, and enjoy premium service at home or in-salon.
        </motion.p>
      </section>

      {/* WHY CLIENTS / WHY PROS */}
      <section className="max-w-6xl mx-auto px-4 pb-4">
        <div className="grid md:grid-cols-2 gap-8">
          <motion.div {...fadeUp} className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-6">
            <h3 className="text-xl font-semibold mb-3">Why Clients Use Kpocha</h3>
            <ul className="space-y-3 text-zinc-300">
              <li><span className="text-emerald-400">✔</span> Verified, top-rated professionals</li>
              <li><span className="text-emerald-400">✔</span> Book in minutes with clear pricing</li>
              <li><span className="text-emerald-400">✔</span> Secure Paystack payments</li>
              <li><span className="text-emerald-400">✔</span> Home or in-salon — your choice</li>
            </ul>
          </motion.div>

          <motion.div {...fadeUp} className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-6">
            <h3 className="text-xl font-semibold mb-3">Why Professionals Join</h3>
            <ul className="space-y-3 text-zinc-300">
              <li><span className="text-emerald-400">✔</span> Get discovered by clients in your area</li>
              <li><span className="text-emerald-400">✔</span> Manage bookings and payouts easily</li>
              <li><span className="text-emerald-400">✔</span> Transparent commissions</li>
              <li><span className="text-emerald-400">✔</span> Build your brand with reviews</li>
            </ul>
          </motion.div>
        </div>
      </section>

      {/* SHOWCASE BAND */}
      <section className="relative">
        <div
          className="relative max-w-6xl mx-auto my-12 rounded-2xl overflow-hidden border border-zinc-800"
          style={{
            backgroundImage:
              "url('https://res.cloudinary.com/dupex2y3k/image/upload/v1760305198/kpocha-background-2_hsmavd.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative px-6 py-16 text-center">
            <motion.h3 {...fadeUp} className="text-2xl sm:text-3xl font-bold mb-2">
              Built for Nigeria.
            </motion.h3>
            <motion.p {...fadeUp} className="text-zinc-300 max-w-2xl mx-auto">
              From Lagos to Kano, Port Harcourt to Abuja — trusted grooming, verified professionals,
              and smooth bookings that just work.
            </motion.p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="text-center px-4 py-16 bg-gradient-to-b from-zinc-950 via-black to-zinc-950 border-t border-emerald-900/30">
        <motion.h4 {...fadeUp} className="text-2xl font-bold mb-4">
          Ready to Experience Premium Grooming?
        </motion.h4>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5 }}
          className="flex justify-center gap-4"
        >
          <button
            type="button"
            onClick={onFindProClick}
            className="rounded-xl bg-gold text-black px-6 py-3 font-semibold hover:bg-yellow-500 transition"
          >
            Get Started
          </button>
          <Link
            to="/become"
            className="rounded-xl border border-zinc-700 px-6 py-3 hover:bg-zinc-900 transition"
          >
            Join as a Pro
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
