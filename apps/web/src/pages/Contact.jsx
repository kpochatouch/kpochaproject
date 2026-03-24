//apps/web/src/pages/Contact.jsx
import { useEffect, useMemo, useState } from "react";
import { submitContactMessage } from "../lib/api.js";

const SUPPORT_EMAIL = "support@kpochatouch.com";
const SUPPORT_PHONE = "+2348130118690";
const WHATSAPP_LINK = "https://wa.me/2348130118690";
const OFFICE_ADDRESS = "23, Adesuwa Road, G. R. A., Benin City";
const SUPPORT_CHAT_PATH = "/support";

const CONTACT_CARDS = [
  {
    title: "Our Location",
    body: [OFFICE_ADDRESS],
    icon: "⌂",
    href: null,
  },
  {
    title: "Email Address",
    body: [SUPPORT_EMAIL],
    icon: "✉",
    href: `mailto:${SUPPORT_EMAIL}`,
  },
  {
    title: "Phone Number",
    body: [SUPPORT_PHONE],
    icon: "☎",
    href: `tel:${SUPPORT_PHONE}`,
  },
  {
    title: "WhatsApp",
    body: ["Chat with our support team on WhatsApp"],
    icon: "◉",
    href: WHATSAPP_LINK,
  },
  {
    title: "In-App Support",
    body: ["Open support chat inside Kpocha Touch"],
    icon: "💬",
    href: SUPPORT_CHAT_PATH,
  },
];

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

  useEffect(() => {
    const items = document.querySelectorAll(".revealUp");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("isVisible");
        });
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -40px 0px",
      },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  function update(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleEmailClick(e) {
    const isDesktop = window.matchMedia("(min-width: 921px)").matches;

    if (!isDesktop) return;

    e.preventDefault();

    const formSection = document.getElementById("contact-form");
    if (formSection) {
      formSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    setOk("");

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
    <main className="contactPage">
      <section className="contactHero">
        <div className="homeHeroBackdrop" aria-hidden="true">
          <div className="homeHeroBackdropGlow homeHeroGlowA" />
          <div className="homeHeroBackdropGlow homeHeroGlowB" />
          <div className="homeHeroBackdropGrid" />
        </div>

        <div className="container">
          <div className="contactHeroShell">
            <div className="contactHeroCopy">
              <div className="pill revealUp reveal1">
                Client Support • Professional Support • Business Enquiries
              </div>

              <h1 className="contactHeroTitle revealUp reveal2">
                Contact the Kpocha Touch support team.
              </h1>

              <p className="contactHeroLead revealUp reveal3">
                Reach out for booking help, account questions, onboarding
                support, professional enquiries, or general assistance. Kpocha
                Touch gives clients and professionals multiple ways to get help
                quickly and directly.
              </p>
            </div>

            <div className="contactHeroPanel revealUp reveal4">
              <div className="contactHeroPanelInner">
                <span className="contactPanelKicker">Direct Support</span>
                <h2>Speak with our team</h2>
                <p>
                  Use the contact details below, chat with us on the platform,
                  or send us a message directly from this page.
                </p>

                <div className="contactHeroMiniList">
                  <a
                    className="contactHeroMiniItem"
                    href={mailto}
                    onClick={handleEmailClick}
                  >
                    <span className="contactHeroMiniIcon">✉</span>
                    <div>
                      <strong>Email Support</strong>
                      <small>{SUPPORT_EMAIL}</small>
                    </div>
                  </a>

                  <a
                    className="contactHeroMiniItem"
                    href={`tel:${SUPPORT_PHONE}`}
                  >
                    <span className="contactHeroMiniIcon">☎</span>
                    <div>
                      <strong>Phone Line</strong>
                      <small>{SUPPORT_PHONE}</small>
                    </div>
                  </a>

                  <a
                    className="contactHeroMiniItem"
                    href={WHATSAPP_LINK}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="contactHeroMiniIcon">◉</span>
                    <div>
                      <strong>WhatsApp</strong>
                      <small>Chat with our support team on WhatsApp</small>
                    </div>
                  </a>

                  <a className="contactHeroMiniItem" href={SUPPORT_CHAT_PATH}>
                    <span className="contactHeroMiniIcon">💬</span>
                    <div>
                      <strong>In-App Support</strong>
                      <small>Open support chat inside Kpocha Touch</small>
                    </div>
                  </a>

                  <div className="contactHeroMiniItem">
                    <span className="contactHeroMiniIcon">⌂</span>
                    <div>
                      <strong>Location</strong>
                      <small>{OFFICE_ADDRESS}</small>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="contactDetailsSection">
        <div className="container">
          <div className="contactSectionHead revealUp reveal1">
            <div className="kicker center">CONTACT US</div>
            <h2 className="homeH2 center">Speak with our team</h2>
          </div>

          <div className="contactCardsGrid">
            {CONTACT_CARDS.map((item, i) => {
              const cardClass = `contactCard revealUp reveal${Math.min(
                i + 2,
                5,
              )}${item.href ? " contactCardLink" : ""}`;

              const inner = (
                <>
                  <div className="contactCardIcon">{item.icon}</div>
                  <h3>{item.title}</h3>
                  <div className="contactCardText">
                    {item.body.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                </>
              );

              if (!item.href) {
                return (
                  <div className={cardClass} key={item.title}>
                    {inner}
                  </div>
                );
              }

              const isExternal =
                item.href.startsWith("http") ||
                item.href.startsWith("mailto:") ||
                item.href.startsWith("tel:");

              return isExternal ? (
                <a
                  className={cardClass}
                  key={item.title}
                  href={item.href}
                  target={item.href.startsWith("http") ? "_blank" : undefined}
                  rel={item.href.startsWith("http") ? "noreferrer" : undefined}
                  onClick={
                    item.href.startsWith("mailto:")
                      ? handleEmailClick
                      : undefined
                  }
                >
                  {inner}
                </a>
              ) : (
                <a className={cardClass} key={item.title} href={item.href}>
                  {inner}
                </a>
              );
            })}
          </div>
        </div>
      </section>

      <section className="contactMapSection">
        <div className="container">
          <div className="contactMapCard revealUp reveal2">
            <iframe
              title="Kpocha Touch location map"
              src="https://www.google.com/maps?q=23%20Adesuwa%20Road%2C%20GRA%2C%20Benin%20City&z=15&output=embed"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </section>

      <section id="contact-form" className="contactFormSection">
        <div className="container">
          <div className="contactSectionHead revealUp reveal1">
            <div className="kicker center">SEND A MESSAGE</div>
            <h2 className="homeH2 center">We’d love to hear from you</h2>
          </div>

          <form className="contactFormCard revealUp reveal2" onSubmit={submit}>
            {err ? (
              <div className="contactNotice contactNoticeError">{err}</div>
            ) : null}

            {ok ? (
              <div className="contactNotice contactNoticeSuccess">{ok}</div>
            ) : null}

            <div className="grid2">
              <div>
                <label className="label" htmlFor="contact-name">
                  Your Name
                </label>
                <input
                  id="contact-name"
                  className="input"
                  name="name"
                  value={form.name}
                  onChange={update}
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="contact-email">
                  Your Email
                </label>
                <input
                  id="contact-email"
                  className="input"
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={update}
                  required
                />
              </div>
            </div>

            <div className="grid2">
              <div>
                <label className="label" htmlFor="contact-phone">
                  Phone
                </label>
                <input
                  id="contact-phone"
                  className="input"
                  name="phone"
                  value={form.phone}
                  onChange={update}
                />
              </div>

              <div>
                <label className="label" htmlFor="contact-subject">
                  Subject
                </label>
                <input
                  id="contact-subject"
                  className="input"
                  name="subject"
                  value={form.subject}
                  onChange={update}
                  required
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="contact-message">
                Type message
              </label>
              <textarea
                id="contact-message"
                className="input contactTextarea"
                rows="8"
                name="message"
                value={form.message}
                onChange={update}
                required
              />
            </div>

            <div className="contactFormActions">
              <button
                className="btn btnPrimary"
                type="submit"
                disabled={loading}
              >
                {loading ? "Sending..." : "Send Message"}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="contactSubscribeSection">
        <div className="container">
          <div className="contactSubscribeInner revealUp reveal3">
            <div>
              <h3 className="contactSubscribeTitle">
                Stay informed with Kpocha Touch updates
              </h3>
              <p className="muted contactSubscribeText">
                Receive product updates, support news, and important platform
                information for clients and professionals.
              </p>
            </div>

            <form
              className="contactSubscribeForm"
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                className="input contactSubscribeInput"
                type="email"
                placeholder="Your email"
              />
              <button className="btn btnPrimary" type="submit">
                Subscribe Now
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
