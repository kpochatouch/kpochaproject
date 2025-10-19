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

  // Load auth state
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

  // Check if the signed-in user already has a client profile
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
    if (!me?.uid) return navigate("/signup");   // guest → sign up
    if (!hasClientProfile) return navigate("/register"); // signed in, no profile → create
    return navigate("/browse");                 // ready → browse
  };

  return (
    <div className="bg-black text-white">
      {/* HERO */}
      <section className="relative gradient-hero min-h-screen flex items-center justify-center text-center text-white overflow-hidden">
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
          className="relative z-10 max-w-5xl mx-auto px-4 py-24"
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
        >
          {/* 🔹 Logo */}
          <div className="flex justify-center mb-6">
            <img
              src="https://res.cloudinary.com/dupex2y3k/image/upload/v1760302703/kpocha-touch-logo_srzbiu.jpg"
              alt="Kpocha Touch Logo"
              className="h-20 w-20 rounded-full border border-emerald-600 shadow-md shadow-emerald-500/30"
            />
          </div>

          {/* 🔹 Your heading (the missing part) */}
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-4">
            Kpocha Touch <span className="text-gold">Unisex Salon</span>
          </h1>

          <p className="text-zinc-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            Connecting you to top barbers and stylists across <span className="text-gold">Nigeria</span>.<br />
            Book home or in-salon services in minutes.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {/* ✅ Smart CTA */}
            <button
              type="button"
              onClick={onFindProClick}
              className="rounded-xl bg-gold text-black px-6 py-3 font-semibold hover:bg-yellow-500 transition duration-300 shadow-lg shadow-yellow-500/30"
            >
              Find a Professional
            </button>

            {/* Secondary CTA */}
            <Link
              to="/become"
              className="rounded-xl border border-zinc-600 px-6 py-3 text-white font-semibold hover:bg-zinc-900 transition duration-300"
            >
              Become a Professional
            </Link>
          </div>
        </motion.div>

        <motion.div
          className="absolute bottom-0 left-0 w-full py-3 bg-black/40 border-t border-emerald-800 text-emerald-300 text-sm tracking-wide overflow-hidden whitespace-nowrap"
          animate={{ x: ["100%", "-100%"] }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        >
          ✨ Verified Pros • Secure Paystack Payments • 36 States & FCT • Home & Salon Services ✨
        </motion.div>
      </section>

      {/* GOLD BRAND STRIPE */}
      <section className="bg-gold text-black">
        <div className="max-w-6xl mx-auto px-4 py-8 text-center">
          <motion.p {...fadeUp} className="text-lg sm:text-xl font-semibold tracking-wide">
            Nigeria’s grooming marketplace — trusted by clients and professionals nationwide.
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
          <span className="text-gold">verified</span> barbers and stylists across Nigeria.
          Discover trusted pros, book instantly, pay securely, and enjoy premium service at home or in-salon.
        </motion.p>
      </section>

      {/* WHY CLIENTS / WHY PROS */}
      <section className="max-w-6xl mx-auto px-4 pb-4">
        <div className="grid md:grid-cols-2 gap-8">
          <motion.div {...fadeUp} className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-6">
            <h3 className="text-xl font-semibold mb-3">Why Clients Use Kpocha</h3>
            <ul className="space-y-3 text-zinc-300">
              <li className="flex items-start gap-3"><span className="text-emerald-400">✔</span>Verified, top-rated professionals across Nigeria</li>
              <li className="flex items-start gap-3"><span className="text-emerald-400">✔</span>Book in minutes — clear pricing and availability</li>
              <li className="flex items-start gap-3"><span className="text-emerald-400">✔</span>Secure Paystack payments and instant confirmations</li>
              <li className="flex items-start gap-3"><span className="text-emerald-400">✔</span>Home service or in-salon — your choice</li>
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

          <motion.div {...fadeUp} className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-6">
            <h3 className="text-xl font-semibold mb-3">Why Professionals Join</h3>
            <ul className="space-y-3 text-zinc-300">
              <li className="flex items-start gap-3"><span className="text-emerald-400">✔</span>Get discovered by new clients in your city</li>
              <li className="flex items-start gap-3"><span className="text-emerald-400">✔</span>Easy scheduling, bookings, and payouts</li>
              <li className="flex items-start gap-3"><span className="text-emerald-400">✔</span>Transparent commission with on-time settlements</li>
              <li className="flex items-start gap-3"><span className="text-emerald-400">✔</span>Build your brand with reviews and a clean profile</li>
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

      {/* HOW IT WORKS */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <motion.h3 {...fadeUp} className="text-2xl sm:text-3xl font-bold text-center mb-10">
          How It Works
        </motion.h3>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { t: "Find a Professional", d: "Browse verified experts near you." },
            { t: "Book & Pay", d: "Pick a time and pay securely via Paystack." },
            { t: "Get Styled", d: "At home or in-salon — premium service, on time." },
          ].map((s, i) => (
            <motion.div
              key={s.t}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="p-6 rounded-xl border border-zinc-800 bg-zinc-950/40"
            >
              <div className="text-emerald-400 font-semibold mb-2">Step {i + 1}</div>
              <div className="font-semibold mb-1">{s.t}</div>
              <p className="text-zinc-400 text-sm">{s.d}</p>
            </motion.div>
          ))}
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
