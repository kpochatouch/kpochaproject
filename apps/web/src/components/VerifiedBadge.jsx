//apps/web/src/components/VerifiedBadge.jsx
export default function VerifiedBadge({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-[#D4AF37] shrink-0 ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        className="w-[0.9em] h-[0.9em]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M7 12.5L10.2 15.7L17.5 8.5"
          stroke="#000000"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
