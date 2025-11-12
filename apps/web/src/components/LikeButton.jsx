import ActionButton from "./ActionButton.jsx";

export default function LikeButton({ active, onClick, className = "" }) {
  return (
    <ActionButton active={active} onClick={onClick} className={className}>
      👍 {active ? "Liked" : "Like"}
    </ActionButton>
  );
}
