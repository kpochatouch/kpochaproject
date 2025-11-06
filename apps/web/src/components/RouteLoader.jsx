// apps/web/src/components/RouteLoader.jsx
export default function RouteLoader({ full = false }) {
  return (
    <div
      className={
        full
          ? "flex-1 flex items-center justify-center bg-black text-white"
          : "p-6"
      }
    >
      <div className="w-full max-w-md space-y-3">
        <div className="h-4 bg-zinc-800/70 rounded w-32 animate-pulse" />
        <div className="h-8 bg-zinc-800/40 rounded animate-pulse" />
        <div className="h-24 bg-zinc-800/20 rounded animate-pulse" />
      </div>
    </div>
  );
}
