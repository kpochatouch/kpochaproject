// apps/web/src/pages/Home.jsx
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
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

  // ✅ Only call /api/me if we already have a token
  useEffect(() => {
    const token =
      (typeof window !== "undefined" && localStorage.getItem("token")) || null;
    if (!token) {
      setMe(null);
      return;
    }

    (async () => {
      try {
        const { data } = await api.get("/api/me");
        setMe(data);
      } catch {
        setMe(null);
      }
    })();
  }, []);

  // ✅ Only check client profile if we have a user
  useEffect(() => {
    if (!me?.uid) {
      setHasClientProfile(false);
      return;
    }
    (async () => {
      try {
        const { data } = await api.get("/api/profile/client/me");
        setHasClientProfile(!!data);
      } catch {
        setHasClientProfile(false);
      }
    })();
  }, [me?.uid]);

  // ✅ unified logic
  const onFindProClick = () => {
    if (!me?.uid) return navigate("/client/register");
    if (!hasClientProfile) return navigate("/client/register");
    return navigate("/browse");
  };

  return (
    <div className="bg-black text-white overflow-x-hidden">
      {/* HERO */}
      <section
        className={`
          relative gradient-hero
          mt-[60px]          /* sit below sticky navbar */
          min-h-[85vh]       /* not full 100vh so ticker + gold show */
          flex items-center justify-center
          text-center text-white
          overflow-hidden
          pb-20
        `}
      >
        <video
          className="absolute inset-0 w-full h-full object-cover opacity-30"
          src="https://res.cloudinary.com/dupex2y3k/video/upload/v1760305198/kpocha-background-1_s2s9k9.mp4"
          autoPlay
          loop
          muted
          playsInline
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-black/80" />

        <motion.div
          className="relative z-10 w-full max-w-5xl mx-auto px-4"
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
        >
          {/* 🔹 Logo */}
          <div className="flex justify-center mb-5">
            <img
              src="https://res.cloudinary.com/dupex2y3k/image/upload/v1760302703/kpocha-touch-logo_srzbiu.jpg"
              alt="Kpocha Touch Logo"
              className="h-20 w-20 rounded-full border border-emerald-600 shadow-md shadow-emerald-500/30"
            />
          </div>

          {/* 🔹 Heading */}
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-3">
            Kpocha Touch <span className="text-gold">Unisex Salon</span>
          </h1>

          <p className="text-zinc-300 max-w-2xl mx-auto mb-8 leading-relaxed text-sm sm:text-base">
            Connecting you to top barbers and stylists across{" "}
            <span className="text-gold">Nigeria</span>. Book home or in-salon
            services in minutes.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              type="button"
              onClick={onFindProClick}
              className="rounded-xl bg-gold text-black px-6 py-3 font-semibold hover:bg-yellow-500 transition duration-300 shadow-lg shadow-yellow-500/30 w-full sm:w-auto"
            >
              Find a Professional
            </button>

            <Link
              to="/become"
              className="rounded-xl border border-zinc-600 px-6 py-3 text-white font-semibold hover:bg-zinc-900 transition duration-300 w-full sm:w-auto text-center"
            >
              Become a Professional
            </Link>
          </div>
        </motion.div>

        {/* ✅ ticker */}
        <motion.div
          className="absolute bottom-0 left-0 w-full py-3 bg-black/40 border-t border-emerald-800 text-emerald-300 text-sm tracking-wide overflow-hidden"
          animate={{ x: ["100%", "-100%"] }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        >
          <div className="whitespace-nowrap px-4">
            ✨ Verified Pros • Secure Paystack Payments • 36 States &amp; FCT •
            Home &amp; Salon Services ✨
          </div>
        </motion.div>
      </section>

      {/* GOLD STRIPE (should now be slightly visible after hero) */}
      <section className="bg-gold text-black">
        <div className="max-w-6xl mx-auto px-4 py-8 text-center">
          <motion.p
            {...fadeUp}
            className="text-lg sm:text-xl font-semibold tracking-wide"
          >
            Nigeria’s grooming marketplace — trusted by clients and
            professionals nationwide.
          </motion.p>
        </div>
      </section>

      {/* (rest stays same) */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <motion.h2
          {...fadeUp}
          className="text-2xl sm:text-3xl font-bold text-center mb-4"
        >
          Who We Are
        </motion.h2>
        <motion.p
          {...fadeUp}
          className="text-zinc-300 text-center max-w-3xl mx-auto"
        >
          Kpocha Touch Unisex Salon connects clients to{" "}
          <span className="text-gold">verified</span> barbers and stylists
          across Nigeria. Discover trusted pros, book instantly, pay securely,
          and enjoy premium service at home or in-salon.
        </motion.p>
      </section>

      <section className="max-w-6xl mx-auto px-4 pb-4">
        <div className="grid md:grid-cols-2 gap-8">
          <motion.div
            {...fadeUp}
            className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-6"
          >
            <h3 className="text-xl font-semibold mb-3">
              Why Clients Use Kpocha
            </h3>
            <ul className="space-y-3 text-zinc-300">
              <li>
                <span className="text-emerald-400">✔</span> Verified, top-rated
                professionals
              </li>
              <li>
                <span className="text-emerald-400">✔</span> Book in minutes —
                clear pricing
              </li>
              <li>
                <span className="text-emerald-400">✔</span> Secure Paystack
                payments
              </li>
              <li>
                <span className="text-emerald-400">✔</span> Home or in-salon —
                your choice
              </li>
            </ul>
            <div className="mt-6">
              <button
                type="button"
                onClick={onFindProClick}
                className="inline-block rounded-xl bg-gold text-black px-5 py-3 font-semibold hover:bg-yellow-500 transition"
              >
                Find a Professional
              </button>
            </div>
          </motion.div>

          <motion.div
            {...fadeUp}
            className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-6"
          >
            <h3 className="text-xl font-semibold mb-3">
              Why Professionals Join
            </h3>
            <ul className="space-y-3 text-zinc-300">
              <li>
                <span className="text-emerald-400">✔</span> Get discovered by
                new clients
              </li>
              <li>
                <span className="text-emerald-400">✔</span> Easy scheduling and
                payouts
              </li>
              <li>
                <span className="text-emerald-400">✔</span> Transparent
                commissions
              </li>
              <li>
                <span className="text-emerald-400">✔</span> Build your brand
                with reviews
              </li>
            </ul>
            <div className="mt-6">
              <Link
                to="/become"
                className="inline-block rounded-xl border border-zinc-700 px-5 py-3 hover:bg-zinc-900 transition"
              >
                Become a Professional
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-16">
        <motion.h3
          {...fadeUp}
          className="text-2xl sm:text-3xl font-bold text-center mb-10"
        >
          How It Works
        </motion.h3>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { t: "Find a Professional", d: "Browse verified experts near you." },
            { t: "Book & Pay", d: "Pick a time and pay securely via Paystack." },
            {
              t: "Get Styled",
              d: "At home or in-salon — premium service, on time.",
            },
          ].map((s, i) => (
            <motion.div
              key={s.t}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="p-6 rounded-xl border border-zinc-800 bg-zinc-950/40"
            >
              <div className="text-emerald-400 font-semibold mb-2">
                Step {i + 1}
              </div>
              <div className="font-semibold mb-1">{s.t}</div>
              <p className="text-zinc-400 text-sm">{s.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="text-center px-4 py-16 bg-gradient-to-b from-zinc-950 via-black to-zinc-950 border-t border-emerald-900/30">
        <motion.h4 {...fadeUp} className="text-2xl font-bold mb-4">
          Ready to Experience Premium Grooming?
        </motion.h4>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col sm:flex-row justify-center gap-4"
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
