//apps/web/srd/components/SavedCard.jsx
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function SavedCards({ onUseCard = () => {} }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // If you later add backend endpoints, swap this to: const { data } = await api.get("/api/cards");
        setCards([]); // no-op placeholder
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading)
    return <div className="text-sm text-zinc-400">Loading cards…</div>;
  if (!cards.length)
    return <div className="text-sm text-zinc-400">No saved cards.</div>;

  return (
    <div className="space-y-2">
      {cards.map((c) => (
        <button
          key={c.id}
          className="w-full text-left px-3 py-2 rounded-lg border border-zinc-800"
          onClick={() => onUseCard(c)}
        >
          {c.brand?.toUpperCase()} •••• {c.last4}
        </button>
      ))}
    </div>
  );
}
