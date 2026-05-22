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

      {/* Simplified legal navigation: link to canonical docs in /docs */}
      <div className="prose text-sm">
        <p>
          The full legal documents for Kpocha Touch are maintained as standalone
          files in the documentation folder. To avoid repeated or conflicting
          text in the app, please refer to the canonical files linked below.
        </p>

        <ul className="list-disc pl-5 space-y-2">
          <li>
            <a
              href="/docs/terms-and-conditions.md"
              className="text-gold underline"
              target="_blank"
              rel="noreferrer"
            >
              Terms &amp; Conditions
            </a>
          </li>
          <li>
            <a
              href="/docs/privacy-policy.md"
              className="text-gold underline"
              target="_blank"
              rel="noreferrer"
            >
              Privacy Policy
            </a>
          </li>
          <li>
            <a
              href="/docs/professional-guide.md"
              className="text-gold underline"
              target="_blank"
              rel="noreferrer"
            >
              Professional Guide (Agreement &amp; Onboarding)
            </a>
          </li>
          <li>
            <a
              href="/docs/user-guide.md"
              className="text-gold underline"
              target="_blank"
              rel="noreferrer"
            >
              User Guide
            </a>
          </li>
          <li>
            <a
              href="/docs/faq.md"
              className="text-gold underline"
              target="_blank"
              rel="noreferrer"
            >
              FAQ
            </a>
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
