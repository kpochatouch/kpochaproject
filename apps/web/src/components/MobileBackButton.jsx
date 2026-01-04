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
      className="md:hidden p-2 rounded-full hover:bg-zinc-800"
      aria-label="Go back"
    >
      ‹
    </button>
  );
}
