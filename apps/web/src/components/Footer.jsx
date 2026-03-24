// apps/web/src/components/Footer.jsx
import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer
      className="border-t text-sm"
      style={{
        borderColor: "var(--app-border)",
        backgroundColor: "var(--app-navbar)",
        color: "var(--app-text-soft)",
      }}
    >
      <div className="max-w-[1440px] mx-auto px-4 md:px-5 py-10">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <div className="text-base font-semibold text-gold">
              Kpocha Touch
            </div>
            <p className="mt-3 text-sm leading-6">
              Discover professionals, showcase work, connect with clients, and
              book services in one place.
            </p>
          </div>

          <div>
            <div className="text-sm font-semibold text-[var(--app-text)]">
              Explore
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <Link to="/browse" className="hover:text-gold">
                Showcase
              </Link>
              <Link to="/browse?tab=pros" className="hover:text-gold">
                Book Professionals
              </Link>
              <Link to="/for-you" className="hover:text-gold">
                For You
              </Link>
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-[var(--app-text)]">
              Business
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <Link to="/become" className="hover:text-gold">
                Become a Pro
              </Link>
              <Link to="/my-adverts" className="hover:text-gold">
                My Adverts
              </Link>
              <Link to="/pro-dashboard" className="hover:text-gold">
                Pro Dashboard
              </Link>
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-[var(--app-text)]">
              Support
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <Link to="/contact" className="hover:text-gold">
                Contact Support
              </Link>
              <Link to="/legal" className="hover:text-gold">
                Legal
              </Link>
            </div>
          </div>
        </div>

        <div
          className="mt-8 pt-6 border-t text-xs flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
          style={{ borderColor: "var(--app-border)" }}
        >
          <div>© {new Date().getFullYear()} Kpocha Touch — Nigeria</div>
          <div>Built for discovery, booking, and professional growth.</div>
        </div>
      </div>
    </footer>
  );
}
