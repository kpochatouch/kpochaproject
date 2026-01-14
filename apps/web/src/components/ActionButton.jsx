//apps/web/src/components/ActionButton.jsx
export default function ActionButton({
  active = false,
  onClick,
  disabled = false,
  children,
  className = "",
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex-1 py-2 text-sm flex items-center justify-center gap-1",
        active ? "text-[#F5C542]" : "text-gray-200",
        disabled ? "opacity-60 cursor-not-allowed" : "hover:text-white",
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}
