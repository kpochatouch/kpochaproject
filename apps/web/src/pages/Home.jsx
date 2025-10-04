import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <section className="gradient-hero">
      <div className="max-w-6xl mx-auto px-4 py-24 text-center">
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight">
          Kpocha Touch <span className="text-gold">Unisex Salon</span>
        </h1>
        <p className="mt-4 text-zinc-300 max-w-2xl mx-auto">
          Connecting You To Top Barbers and Stylists across Edo State. Book home or in-salon services in minutes.
        </p>

        <div className="mt-8 flex items-center justify-center gap-4">
          {/* ✅ Find a professional */}
          <Link
            to="/browse"
            className="rounded-xl bg-gold text-black px-5 py-3 font-semibold hover:bg-yellow-500 transition"
          >
            Find a Professional
          </Link>

          {/* ✅ Become a professional (internal route, no external link) */}
          <Link
            to="/become"
            className="rounded-xl border border-zinc-700 px-5 py-3 hover:bg-zinc-900 transition"
          >
            Become a Professional
          </Link>
        </div>
      </div>
    </section>
  )
}
