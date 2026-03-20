// apps/web/src/components/Footer.jsx
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
      <div className="max-w-[1440px] mx-auto px-4 md:px-5 py-8">
        © {new Date().getFullYear()} Kpocha Touch — Nigeria
      </div>
    </footer>
  );
}
