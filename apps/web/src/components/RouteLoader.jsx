// apps/web/src/components/RouteLoader.jsx

const LOGO_SRC = "/logo-kpocha.png";

export default function RouteLoader({ full = false }) {
  if (full) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-black">
        <img
          src={LOGO_SRC}
          alt="Kpocha Touch"
          className="w-24 h-24 md:w-32 md:h-32 object-contain animate-pulse drop-shadow-lg"
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="w-full max-w-md space-y-3">
        <div className="h-4 bg-zinc-800/70 rounded w-32 animate-pulse" />
        <div className="h-8 bg-zinc-800/40 rounded animate-pulse" />
        <div className="h-24 bg-zinc-800/20 rounded animate-pulse" />
      </div>
    </div>
  );
}
