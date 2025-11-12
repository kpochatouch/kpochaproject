import ActionButton from "./ActionButton.jsx";

export default function CommentToggle({ onClick, className = "" }) {
  return (
    <ActionButton onClick={onClick} className={className}>
      💬 Comment
    </ActionButton>
  );
}
