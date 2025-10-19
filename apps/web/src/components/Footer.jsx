export default function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-black text-zinc-400 text-sm">
      <div className="max-w-6xl mx-auto px-4 py-8 text-left">
        © {new Date().getFullYear()} Kpocha Touch — Nigeria
      </div>
    </footer>
  );
}
