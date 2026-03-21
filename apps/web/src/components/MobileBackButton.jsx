//apps/web/src/components/MobileBackButton.jsx
import { useNavigate } from "react-router-dom";

export default function MobileBackButton({ fallback = "/" }) {
  const navigate = useNavigate();

  function goBack() {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  }

  return (
    <button
      onClick={goBack}
      className="md:hidden min-w-[44px] h-11 px-3 flex items-center justify-center rounded-full hover:bg-zinc-800 text-white"
      aria-label="Go back"
      type="button"
    >
      <span className="text-3xl leading-none">‹</span>
    </button>
  );
}
