// apps/web/src/pages/Contact.jsx
import React, { useMemo, useState } from "react";

const SUPPORT_EMAIL = "kpochaout@gmail.com";

function buildSupportMailto({ bookingId = "", serviceName = "" } = {}) {
  const subject = bookingId
    ? `Kpocha Touch Support — Booking ${bookingId}`
    : "Kpocha Touch Support";

  const body = `Hello Kpocha Touch Support,

${bookingId ? `Booking ID: ${bookingId}\n` : ""}${serviceName ? `Service: ${serviceName}\n` : ""}

Explain your issue here...`;

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

export default function Contact() {
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );

  const bookingId = params.get("bookingId") || "";
  const serviceName = params.get("serviceName") || "";

  const [copied, setCopied] = useState(false);

  const mailto = useMemo(
    () => buildSupportMailto({ bookingId, serviceName }),
    [bookingId, serviceName],
  );

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: do nothing
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold">Contact Support</h1>
      <p className="text-sm text-zinc-400 mt-2">
        If your email app does not open automatically, you can copy the email
        and send a message manually.
      </p>

      <div className="mt-6 rounded-xl border border-zinc-800 bg-black/40 p-4 space-y-3">
        <div className="text-sm text-zinc-500">Support email</div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-base font-semibold break-all">
            {SUPPORT_EMAIL}
          </div>
          <button
            type="button"
            onClick={copyEmail}
            className="px-3 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {(bookingId || serviceName) && (
          <div className="text-xs text-zinc-500">
            {bookingId ? <div>Booking ID: {bookingId}</div> : null}
            {serviceName ? <div>Service: {serviceName}</div> : null}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <a
            href={mailto}
            className="px-4 py-2 rounded-lg bg-gold text-black font-semibold"
          >
            Try opening email app
          </a>

          <a
            href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
              SUPPORT_EMAIL,
            )}&su=${encodeURIComponent(
              bookingId
                ? `Kpocha Touch Support — Booking ${bookingId}`
                : "Kpocha Touch Support",
            )}`}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
          >
            Open Gmail in browser
          </a>
        </div>

        <p className="text-xs text-zinc-500">
          Tip: If you’re using the installed app (PWA), Gmail-in-browser usually
          works even when mailto doesn’t.
        </p>
      </div>
    </div>
  );
}
