// apps/web/src/components/CallButton.jsx
export default function CallButton({ onStart }) {
  return (
    <button
      className="px-4 py-2 rounded-lg bg-emerald-500 text-black font-semibold"
      onClick={onStart}
      type="button"
    >
      Start Call
    </button>
  );
}
