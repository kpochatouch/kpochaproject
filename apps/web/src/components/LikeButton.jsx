//apps/web/src/components/LikeButton.jsx
import ActionButton from "./ActionButton.jsx";

export default function LikeButton({ active, onClick, className = "" }) {
  return (
    <ActionButton
      active={active}
      onClick={onClick}
      className={className}
      style={{
        color: active ? "#000000" : "var(--app-text)",
        backgroundColor: active ? "#F5C542" : "transparent",
      }}
    >
      👍 {active ? "Liked" : "Like"}
    </ActionButton>
  );
}
