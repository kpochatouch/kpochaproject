// apps/web/src/pages/Legal.jsx
import React from "react";
import { Link } from "react-router-dom";

// PROFESSIONAL SERVICE AGREEMENT — full verbatim text (no summarising)
// Drop large embedded contract text; use canonical docs as single source of truth.

export default function Legal() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      {/* MAIN HEADING (gold) */}
      <h1 className="text-3xl font-semibold mb-6 text-gold">
        Kpocha Touch — Legal &amp; Policies
      </h1>

      <p className="text-sm text-zinc-400 mb-6">
        This page summarises our product policies for convenience and does not
        constitute legal advice. Your use of Kpocha Touch signifies your
        agreement to these terms.
      </p>

      {/* NAV */}
      <nav className="mb-8 text-sm">
        <p className="mb-2 text-gold font-semibold">Jump to a section:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <a href="#client-terms" className="text-gold underline">
              Client Terms
            </a>
          </li>
          <li>
            <a href="#privacy" className="text-gold underline">
              Privacy Policy
            </a>
          </li>
          <li>
            <Link to="/docs" className="text-gold underline">
              Platform Documentation
            </Link>
          </li>
          <li>
            <a href="#pro-agreement" className="text-gold underline">
              Professional Service Agreement
            </a>
          </li>
        </ul>
      </nav>

      <div className="mb-8 flex flex-wrap gap-3">
        <Link
          to="/docs/terms-and-conditions"
          className="inline-flex items-center justify-center rounded-full bg-gold px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
        >
          Terms &amp; Conditions
        </Link>
        <Link
          to="/docs/privacy-policy"
          className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          Privacy Policy
        </Link>
        <Link
          to="/docs/professional-guide"
          className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          Professional Guide
        </Link>
        <Link
          to="/contact"
          className="inline-flex items-center justify-center rounded-full border border-gold px-4 py-2 text-sm font-semibold text-gold transition hover:bg-gold/10"
        >
          Contact Support
        </Link>
      </div>

      {/* Simplified legal navigation: link to canonical docs in /docs */}
      <div className="prose text-sm">
        <p>
          The full legal documents for Kpocha Touch are maintained as standalone
          files in the documentation folder. To avoid repeated or conflicting
          text in the app, please refer to the canonical files linked below.
        </p>

        <ul className="list-disc pl-5 space-y-2">
          <li>
            <Link
              to="/docs/terms-and-conditions"
              className="text-gold underline"
            >
              Terms &amp; Conditions
            </Link>
          </li>
          <li>
            <Link to="/docs/privacy-policy" className="text-gold underline">
              Privacy Policy
            </Link>
          </li>
          <li>
            <Link to="/docs/professional-guide" className="text-gold underline">
              Professional Guide (Agreement &amp; Onboarding)
            </Link>
          </li>
          <li>
            <Link to="/docs/user-guide" className="text-gold underline">
              User Guide
            </Link>
          </li>
          <li>
            <Link to="/docs/faq" className="text-gold underline">
              FAQ
            </Link>
          </li>
        </ul>

        <p className="mt-4">
          These documents include official details such as company name, RC
          number, contact email, addresses, payout and cancellation policies,
          and professional obligations. If you need an in-app excerpt, use the
          links above to open the canonical document.
        </p>
      </div>

      {/* Footer back link */}
      <div className="mt-10">
        <Link to="/become" className="text-gold underline">
          Back to Application
        </Link>
      </div>
    </div>
  );
}
