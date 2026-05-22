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
          The full legal documents for Kpocha Touch are maintained as
          standalone files in the documentation folder. To avoid repeated or
          conflicting text in the app, please refer to the canonical files
          linked below.
        </p>

        <ul className="list-disc pl-5 space-y-2">
          <li>
            <a href="/docs/terms-and-conditions.md" className="text-gold underline" target="_blank" rel="noreferrer">
              Terms &amp; Conditions
            </a>
          </li>
          <li>
            <a href="/docs/privacy-policy.md" className="text-gold underline" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>
          </li>
          <li>
            <a href="/docs/professional-guide.md" className="text-gold underline" target="_blank" rel="noreferrer">
              Professional Guide (Agreement &amp; Onboarding)
            </a>
          </li>
          <li>
            <a href="/docs/user-guide.md" className="text-gold underline" target="_blank" rel="noreferrer">
              User Guide
            </a>
          </li>
          <li>
            <a href="/docs/faq.md" className="text-gold underline" target="_blank" rel="noreferrer">
              FAQ
            </a>
          </li>
        </ul>

        <p className="mt-4">
          These documents include official details such as company name,
          RC number, contact email, addresses, payout and cancellation
          policies, and professional obligations. If you need an in-app
          excerpt, use the links above to open the canonical document.
        </p>
      </div>
              <span>7. REFUNDS, DISPUTES, AND CANCELLATIONS</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Open disputes in-app with evidence (photos, receipts, chat
                logs).
              </li>
              <li>
                The Company investigates and makes good-faith determinations.
              </li>
              <li>Abuse of refund policy may lead to restrictions.</li>
            </ul>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>8. CONFIDENTIALITY &amp; DATA PRIVACY</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Client data is protected under the Nigeria Data Protection Act
                2023.
              </li>
              <li>
                Necessary info (name, phone, location) may be shared with
                Professionals to fulfil bookings.
              </li>
              <li>
                We do not sell Client data; see Privacy Policy below for full
                details.
              </li>
            </ul>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>9. LIMITATION OF LIABILITY</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <ul className="list-disc pl-5 space-y-1">
              <li>Platform provided “as is”.</li>
              <li>
                No liability for injuries from Professional service, third-party
                payment errors, or downtime.
              </li>
              <li>Max liability limited to the booking value in question.</li>
              <li>Professionals are independent contractors.</li>
            </ul>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>10. ACCOUNT TERMINATION</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                We may suspend/terminate for fraud, policy violations,
                harassment/abuse, chargeback abuse, or rating manipulation.
              </li>
              <li>
                Client may request closure after settling pending transactions.
              </li>
              <li>We may retain transaction records as required by law.</li>
            </ul>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>11. INTELLECTUAL PROPERTY</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Kpocha Touch trademarks, code, and brand assets belong to the
                Company.
              </li>
              <li>No commercial exploitation without permission.</li>
              <li>Suggestions may be used without compensation.</li>
            </ul>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>12. DISPUTE RESOLUTION (NIGERIA)</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <ul className="list-disc pl-5 space-y-1">
              <li>Start with Customer Support.</li>
              <li>
                If unresolved within 14 days → Mediation → then Arbitration
                under the Arbitration and Mediation Act 2023.
              </li>
              <li>Each party bears its own costs unless otherwise directed.</li>
            </ul>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>13. GOVERNING LAW AND FINAL PROVISIONS</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <ul className="list-disc pl-5 space-y-1">
              <li>Governed by the laws of the Federal Republic of Nigeria.</li>
              <li>
                Updates communicated via email or in-app; continued use implies
                acceptance.
              </li>
              <li>If any provision is invalid, the rest remains effective.</li>
            </ul>
          </details>
        </div>
      </Section>

      {/* PRIVACY POLICY (Full) */}
      <Section id="privacy" title="Privacy Policy">
        <div className="space-y-3 text-sm leading-relaxed">
          <details open className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>1. INTRODUCTION</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <p>
              This Privacy Policy explains how KPOCHA TOUCH NIG LTD (“Kpocha
              Touch”, “we”, “us”, “our”) collects, uses, discloses, and protects
              personal data when you use our web or mobile applications,
              products, and services (the “Platform”). It applies to all users,
              including Clients, Professionals, visitors, and staff. By
              accessing or using the Platform, you consent to the practices
              described in this Policy.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>2. SCOPE AND CONTROLLERSHIP</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <p>
              This Policy covers personal data processed by KPOCHA TOUCH NIG LTD
              in connection with the Platform. For most purposes, Kpocha Touch
              acts as a Data Controller. In limited cases (e.g., where
              Professionals process Client data for service delivery),
              Professionals may act as independent controllers for their
              processing activities.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>3. THE DATA WE COLLECT</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Identity &amp; Contact:</strong> name, phone number,
                email, address, gender (optional).
              </li>
              <li>
                <strong>Account &amp; Profile:</strong> credentials, profile
                details, preferences, ratings and reviews.
              </li>
              <li>
                <strong>Booking &amp; Transaction:</strong> services, dates,
                locations, payments, invoices, refunds, disputes.
              </li>
              <li>
                <strong>Device &amp; Technical:</strong> IP, device identifiers,
                OS/browser info, app version, crash logs.
              </li>
              <li>
                <strong>Usage &amp; Cookies:</strong> pages visited, features
                used, time on site, referral sources, session logs.
              </li>
              <li>
                <strong>Media:</strong> photos/videos you upload (e.g., style
                references, portfolio).
              </li>
              <li>
                <strong>Verification &amp; Compliance:</strong> government ID,
                proof of address, and other KYC items where required by law or
                onboarding.
              </li>
            </ul>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>4. HOW WE USE YOUR DATA</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <ul className="list-disc pl-5 space-y-1">
              <li>Create and manage accounts, profiles, and bookings.</li>
              <li>Facilitate payments, refunds, and Wallet operations.</li>
              <li>Provide customer support and dispute resolution.</li>
              <li>
                Verify identity; maintain trust &amp; safety (fraud prevention,
                abuse detection).
              </li>
              <li>
                Improve and personalise the Platform, including analytics and
                performance.
              </li>
              <li>
                Communicate updates, security alerts, and service messages.
              </li>
              <li>
                Comply with legal obligations (tax, accounting, recordkeeping,
                law enforcement requests).
              </li>
            </ul>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>5. LEGAL BASES FOR PROCESSING (NDPA 2023)</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <p>
              We process data under the Nigeria Data Protection Act 2023 on the
              following bases: consent, contract performance, legal obligation,
              legitimate interests (e.g., platform security, service
              improvements), and vital interests (e.g., safety issues). Where
              consent is required (e.g., optional marketing), you may withdraw
              it at any time via your account settings or by contacting us.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>6. COOKIES AND SIMILAR TECHNOLOGIES</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <p>
              We use cookies and similar technologies to remember preferences,
              keep sessions secure, measure usage, and improve features. You can
              manage cookies via your browser or device settings. Disabling some
              cookies may affect Platform functionality.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>7. PAYMENTS AND THIRD PARTIES</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <p>
              Payments are processed via trusted third-party providers. We may
              share necessary transaction details to process payments, prevent
              fraud, and resolve chargebacks. Providers handle your card/bank
              details under their own privacy policies. We also use services for
              analytics, error monitoring, cloud hosting, and communications;
              these processors are bound by confidentiality and data protection
              obligations.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>8. DATA SHARING AND DISCLOSURE</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                With Professionals to fulfil bookings (limited to necessary
                info: name, contact, location).
              </li>
              <li>
                With service providers (processors) who help operate the
                Platform.
              </li>
              <li>
                With authorities or regulators where required by law or to
                protect rights and safety.
              </li>
              <li>
                In connection with a business transfer (merger, acquisition)
                with safeguards in place.
              </li>
              <li>We do not sell personal data.</li>
            </ul>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>9. DATA RETENTION</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <p>
              We retain personal data for as long as needed to provide services,
              comply with legal obligations, resolve disputes, and enforce
              agreements. Retention periods vary by category (e.g., financial
              records may be kept longer to meet tax/regulatory requirements).
              When data is no longer needed, we will securely delete or
              anonymize it.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>10. SECURITY</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <p>
              We implement administrative, technical, and physical safeguards
              appropriate to the sensitivity of the data (e.g., access controls,
              encryption in transit, credential hashing, audit logs). No method
              of transmission or storage is 100% secure; users should also take
              care to protect their accounts and devices.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>11. YOUR PRIVACY RIGHTS</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <p>
              Subject to law, you may have rights to: access, correct, delete,
              restrict or object to processing, data portability, and to
              withdraw consent. Submit requests via in-app support or email. We
              will verify identity and respond within applicable timelines. If
              you are unsatisfied, you may lodge a complaint with the Nigeria
              Data Protection Commission (NDPC).
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>12. CHILDREN&apos;S PRIVACY</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <p>
              The Platform is not intended for children under 16. If you are
              under 16, you may use the Platform only with parental/guardian
              consent where lawful. If we learn we have collected personal data
              from a child without proper consent, we will take steps to delete
              it.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>13. INTERNATIONAL TRANSFERS</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <p>
              Where data is transferred outside Nigeria (e.g., to cloud
              providers), we use appropriate safeguards consistent with the NDPA
              2023, such as contractual clauses and due diligence on processor
              practices.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>14. CHANGES TO THIS POLICY</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <p>
              We may update this Policy to reflect operational, legal, or
              regulatory changes. Material changes will be notified via email or
              in-app notice. Continued use of the Platform after changes
              indicates acceptance.
            </p>
          </details>

          <details className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>15. CONTACT US</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <address className="not-italic">
              KPOCHA TOUCH NIG LTD (RC No. 7455105)
              <br />
              Address: 23, Adesuwa Road, GRA, Benin City, Edo State.
              <br />
              Email:{" "}
              <a
                href="mailto:kpochaout@gmail.com"
                className="underline text-gold"
              >
                kpochaout@gmail.com
              </a>
              <br />
              Website:{" "}
              <a href="https://kpochatouch.com" className="underline text-gold">
                https://kpochatouch.com
              </a>
              <br />
              Last Updated: 18 Oct 2025
            </address>
          </details>
        </div>
      </Section>

      {/* PROFESSIONAL SERVICE AGREEMENT (Full verbatim) */}
      <Section id="pro-agreement" title="Professional Service Agreement">
        <div className="space-y-3 text-sm leading-relaxed">
          <details open className="group">
            <summary className="cursor-pointer select-none font-medium py-2 flex items-center justify-between text-gold">
              <span>Full Text</span>
              <span className="text-xs text-zinc-400 group-open:hidden">
                expand
              </span>
              <span className="text-xs text-zinc-400 hidden group-open:inline">
                collapse
              </span>
            </summary>
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-100">
              {PRO_AGREEMENT_TEXT}
            </pre>
          </details>
        </div>
      </Section>

      {/* Footer back link */}
      <div className="mt-10">
        <Link to="/become" className="text-gold underline">
          Back to Application
        </Link>
      </div>
    </div>
  );
}

/* Section wrapper: section title is gold */
function Section({ id, title, children }) {
  return (
    <section id={id} className="border border-zinc-800 rounded-lg p-4 mb-6">
      <h2 className="text-xl font-semibold mb-1 text-gold">{title}</h2>
      {children}
    </section>
  );
}
