import { Link, Routes, Route } from "react-router-dom";
import DocViewer from "../components/DocViewer.jsx";

export default function Docs() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gold mb-3">
          Kpocha Touch — Help & Documentation
        </h1>
        <p className="text-sm text-zinc-400">
          Learn what Kpocha Touch is, how to book services, how professionals
          join, and where to get support.
        </p>
      </div>

      <h2 className="text-2xl font-semibold mb-3">What is Kpocha Touch?</h2>

      <section className="border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-3">What users can do</h2>

        <ul className="list-disc pl-5 space-y-3 text-sm leading-relaxed text-zinc-300">
          <li>
            Discover professionals, businesses, creators, and service providers
            across Nigeria.
          </li>

          <li>
            Post updates, media content, business promotions, and public
            activity.
          </li>

          <li>
            Follow profiles, interact with content, and engage socially within
            the platform.
          </li>

          <li>
            Use real-time messaging, voice calls, and video calls for
            communication.
          </li>

          <li>
            Browse services, portfolios, ratings, and business information.
          </li>

          <li>
            Book appointments, hire providers, negotiate services, and manage
            transactions securely.
          </li>

          <li>
            Build digital visibility for personal brands, businesses, and local
            services.
          </li>
        </ul>
      </section>

      <section className="border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-3">
          For professionals, businesses, and creators
        </h2>

        <ul className="list-disc pl-5 space-y-3 text-sm leading-relaxed text-zinc-300">
          <li>
            Create verified public profiles for businesses, brands, services, or
            creator identities.
          </li>

          <li>
            Publish services, pricing, portfolios, promotional content, and
            media posts.
          </li>

          <li>
            Receive bookings, inquiries, messages, calls, reviews, and customer
            engagement directly through the platform.
          </li>

          <li>
            Build followers, improve visibility, and grow digital reach across
            multiple industries.
          </li>

          <li>
            Manage earnings, transactions, scheduling, and customer
            relationships from one account.
          </li>

          <li>
            Access communication tools including real-time chat, audio calls,
            and video calls.
          </li>
        </ul>
      </section>

      <section className="border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-3">Quick links</h2>
        <div className="grid sm:grid-cols-4 gap-3 text-sm">
          <Link
            to="/browse"
            className="rounded-xl border border-zinc-700 px-4 py-4 text-zinc-100 hover:bg-zinc-900"
          >
            Browse services
          </Link>
          <Link
            to="/become"
            className="rounded-xl border border-zinc-700 px-4 py-4 text-zinc-100 hover:bg-zinc-900"
          >
            Become a professional
          </Link>
          <Link
            to="/feed"
            className="rounded-xl border border-zinc-700 px-4 py-4 text-zinc-100 hover:bg-zinc-900"
          >
            Explore community feed
          </Link>
          <Link
            to="/legal"
            className="rounded-xl border border-zinc-700 px-4 py-4 text-zinc-100 hover:bg-zinc-900"
          >
            Legal & privacy
          </Link>
        </div>
      </section>

      <section className="border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-3">Documentation</h2>
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <Link
            to="terms-and-conditions"
            className="rounded-xl border border-zinc-700 px-4 py-4 text-zinc-100 hover:bg-zinc-900"
          >
            Terms &amp; Conditions
          </Link>
          <Link
            to="privacy-policy"
            className="rounded-xl border border-zinc-700 px-4 py-4 text-zinc-100 hover:bg-zinc-900"
          >
            Privacy Policy
          </Link>
          <Link
            to="professional-guide"
            className="rounded-xl border border-zinc-700 px-4 py-4 text-zinc-100 hover:bg-zinc-900"
          >
            Professional Guide
          </Link>
          <Link
            to="user-guide"
            className="rounded-xl border border-zinc-700 px-4 py-4 text-zinc-100 hover:bg-zinc-900"
          >
            User Guide
          </Link>
          <Link
            to="faq"
            className="rounded-xl border border-zinc-700 px-4 py-4 text-zinc-100 hover:bg-zinc-900"
          >
            FAQ
          </Link>
        </div>
      </section>

      {/* nested doc routes (viewer) */}
      <Routes>
        <Route path=":slug" element={<DocViewer />} />
      </Routes>

      <section className="border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-3">
          Frequently asked questions
        </h2>
        <div className="space-y-4 text-sm text-zinc-300 leading-relaxed">
          <div>
            <h3 className="font-semibold">How do I book a service?</h3>
            <p>
              1. Find a professional or service (from Browse, a Post, or a
              public profile).
              <br />
              2. Choose the service you want and confirm your address/contact
              details.
              <br />
              3. Create the booking (the app may create an instant/ASAP booking
              or a scheduled booking depending on the professional).
              <br />
              4. Complete payment on the booking details page (Wallet or card).
              Some professionals may offer scheduled appointments; follow the
              scheduling options shown when available.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">How do I become a professional?</h3>
            <p>
              Use the Become a Pro flow, complete your profile, upload
              verification documents, and wait for approval.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">Where can I get support?</h3>
            <p>
              Use the support chat or contact page, or visit the Legal page for
              policy details.
            </p>
          </div>
        </div>
      </section>

      <section className="border border-zinc-800 rounded-xl p-6">
        <h2 className="text-2xl font-semibold mb-3">Need more help?</h2>
        <p className="text-sm leading-relaxed text-zinc-300">
          If you still have questions, use the in-app support widget or the
          contact page. The platform also includes full legal and privacy
          documentation in the Legal section.
        </p>
      </section>
    </div>
  );
}
