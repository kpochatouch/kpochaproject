//apps/web/src/components/DisplayName.jsx
import VerifiedBadge from "./VerifiedBadge.jsx";

export default function DisplayName({
  name,
  verified = false,
  className = "",
  badgeClassName = "w-4 h-4",
  textClassName = "",
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={textClassName}>{name || "Unnamed User"}</span>
      {verified ? <VerifiedBadge className={badgeClassName} /> : null}
    </span>
  );
}
