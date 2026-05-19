import { Link } from "react-router-dom";

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

      <section className="border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-3">What is Kpocha Touch?</h2>
        <p className="text-sm leading-relaxed text-zinc-300">
          Kpocha Touch is a professional booking marketplace for Nigeria. It
          connects clients with verified service providers across categories
          such as beauty, wellness, health, home services, events, and more.
        </p>
      </section>

      <section className="border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-3">For clients</h2>
        <ul className="list-disc pl-5 space-y-2 text-sm leading-relaxed text-zinc-300">
          <li>Search and browse professionals by service, state, or LGA.</li>
          <li>
            View public profiles, galleries, ratings, and service details.
          </li>
          <li>Book services securely through the app and pay safely.</li>
          <li>
            Manage upcoming bookings, communicate with providers, and leave
            reviews.
          </li>
        </ul>
      </section>

      <section className="border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-3">For professionals</h2>
        <ul className="list-disc pl-5 space-y-2 text-sm leading-relaxed text-zinc-300">
          <li>Create a verified pro profile and list your services.</li>
          <li>
            Receive booking requests, manage your schedule, and handle client
            communication.
          </li>
          <li>Get paid via the platform after commission deduction.</li>
          <li>
            Maintain service quality, confidentiality, and platform compliance.
          </li>
        </ul>
      </section>

      <section className="border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-3">Quick links</h2>
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
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
            to="/legal"
            className="rounded-xl border border-zinc-700 px-4 py-4 text-zinc-100 hover:bg-zinc-900"
          >
            Legal & privacy
          </Link>
        </div>
      </section>

      <section className="border border-zinc-800 rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-semibold mb-3">
          Frequently asked questions
        </h2>
        <div className="space-y-4 text-sm text-zinc-300 leading-relaxed">
          <div>
            <h3 className="font-semibold">How do I book a service?</h3>
            <p>
              Search for a professional, select the service, choose a date and
              time, then confirm and pay.
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
