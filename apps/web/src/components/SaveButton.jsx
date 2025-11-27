//apps/web/src/components/SaveButton.jsx
import ActionButton from "./ActionButton.jsx";
export default function SaveButton({ active, onClick, className = "" }) {
  return (
    <ActionButton active={active} onClick={onClick} className={className}>
      💾 {active ? "Saved" : "Save"}
    </ActionButton>
  );
}
