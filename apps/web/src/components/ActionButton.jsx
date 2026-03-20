//apps/web/src/components/ActionButton.jsx
export default function ActionButton({
  active = false,
  onClick,
  disabled = false,
  children,
  className = "",
  style = {},
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex-1 py-3 text-[15px] font-medium flex items-center justify-center gap-1 transition-colors",
        disabled ? "opacity-60 cursor-not-allowed" : "",
        className,
      ].join(" ")}
      style={{
        color: active ? "#000000" : "var(--app-text)",
        backgroundColor: active ? "#F5C542" : "transparent",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
