//apps/web/src/components/ShareButton.jsx
import ActionButton from "./ActionButton.jsx";
export default function ShareButton({ onClick, className = "" }) {
  return (
    <ActionButton onClick={onClick} className={className}>
      ↗ Share
    </ActionButton>
  );
}
