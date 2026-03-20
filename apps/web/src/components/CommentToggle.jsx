// apps/web/src/components/CommentToggle.jsx
import ActionButton from "./ActionButton.jsx";

export default function CommentToggle({ onClick, className = "" }) {
  return (
    <ActionButton
      onClick={onClick}
      className={className}
      style={{
        color: "var(--app-text)",
        backgroundColor: "transparent",
      }}
    >
      💬 Comment
    </ActionButton>
  );
}
