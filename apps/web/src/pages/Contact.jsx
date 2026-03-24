//apps/web/src/pages/Contact.jsx
import { useMemo, useState } from "react";
import { submitContactMessage } from "../lib/api.js";

const SUPPORT_EMAIL = "kpochaout@gmail.com";

function buildSupportMailto({ bookingId = "", serviceName = "" } = {}) {
  const subject = bookingId
    ? `Kpocha Touch Support — Booking ${bookingId}`
    : "Kpocha Touch Support";

  const body = `Hello Kpocha Touch Support,

${bookingId ? `Booking ID: ${bookingId}\n` : ""}${
    serviceName ? `Service: ${serviceName}\n` : ""
  }

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
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    subject: bookingId
      ? `Support request for booking ${bookingId}`
      : "Kpocha Touch Support",
    message:
      bookingId || serviceName
        ? `${bookingId ? `Booking ID: ${bookingId}\n` : ""}${
            serviceName ? `Service: ${serviceName}\n` : ""
          }\nExplain your issue here...`
        : "",
  });

  const mailto = useMemo(
    () => buildSupportMailto({ bookingId, serviceName }),
    [bookingId, serviceName],
  );

  function update(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setOk("");
    setErr("");

    try {
      await submitContactMessage(form);
      setOk("Your message has been sent successfully.");
      setForm({
        name: "",
        email: "",
        phone: "",
        subject: bookingId
          ? `Support request for booking ${bookingId}`
          : "Kpocha Touch Support",
        message:
          bookingId || serviceName
            ? `${bookingId ? `Booking ID: ${bookingId}\n` : ""}${
                serviceName ? `Service: ${serviceName}\n` : ""
              }\nExplain your issue here...`
            : "",
      });
    } catch (e2) {
      setErr(
        e2?.response?.data?.error || e2?.message || "Failed to send message.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Contact Support</h1>
        <p className="text-sm text-zinc-400 mt-2">
          Send us a message directly here, or use your email app if you prefer.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
        <div className="rounded-xl border border-zinc-800 bg-black/40 p-4 space-y-4">
          <div>
            <div className="text-sm text-zinc-500">Support email</div>
            <div className="mt-1 text-base font-semibold break-all">
              {SUPPORT_EMAIL}
            </div>
          </div>

          <button
            type="button"
            onClick={copyEmail}
            className="px-3 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
          >
            {copied ? "Copied" : "Copy email"}
          </button>

          {(bookingId || serviceName) && (
            <div className="text-xs text-zinc-500 space-y-1">
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
            Tip: If you’re using the installed app (PWA), Gmail-in-browser
            usually works even when mailto doesn’t.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-xl border border-zinc-800 bg-black/40 p-4 space-y-4"
        >
          {err ? (
            <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {err}
            </div>
          ) : null}

          {ok ? (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
              {ok}
            </div>
          ) : null}

          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Your name
            </label>
            <input
              className="input w-full"
              name="name"
              value={form.name}
              onChange={update}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Your email
            </label>
            <input
              className="input w-full"
              type="email"
              name="email"
              value={form.email}
              onChange={update}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Phone</label>
            <input
              className="input w-full"
              name="phone"
              value={form.phone}
              onChange={update}
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Subject</label>
            <input
              className="input w-full"
              name="subject"
              value={form.subject}
              onChange={update}
              required
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Message</label>
            <textarea
              className="input w-full min-h-[180px]"
              name="message"
              value={form.message}
              onChange={update}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-gold text-black font-semibold disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send message"}
          </button>
        </form>
      </div>
    </div>
  );
}
