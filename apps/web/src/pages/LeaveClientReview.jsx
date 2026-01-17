//apps/web/src/pages/LeaveClientReview.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useMe } from "../context/MeContext.jsx";

export default function LeaveClientReview() {
  const { clientUid } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { me } = useMe();

  const bookingId = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return p.get("bookingId") || null;
  }, [location.search]);

  const [existing, setExisting] = useState(null);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  // load "my review for this client"
  useEffect(() => {
    if (!clientUid) return;
    (async () => {
      try {
        const { data } = await api.get(`/api/reviews/client/${encodeURIComponent(clientUid)}/me`);
        setExisting(data || null);
      } catch {
        setExisting(null);
      }
    })();
  }, [clientUid]);

  async function submit() {
    if (!clientUid) return;
    setBusy(true);
    try {
      const payload = {
        clientUid,
        bookingId,
        rating,
        title,
        comment,
        photos: [],
      };

      const { data } = await api.post("/api/reviews/client", payload);

      if (data?.ok) {
        alert("✅ Review submitted.");
        navigate(-1);
        return;
      }

      alert("❌ Could not submit review.");
    } catch (e) {
      const code = e?.response?.status;
      const err = e?.response?.data?.error;

      if (code === 409 && err === "already_reviewed") {
        alert("You already reviewed this client.");
      } else if (code === 403 && err === "only_pro_can_review_client") {
        alert("Only professionals can review clients.");
      } else {
        alert("❌ Submit failed. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (existing) {
    return (
      <div className="max-w-xl mx-auto p-4">
        <h1 className="text-xl font-semibold">Review Client</h1>
        <p className="text-zinc-400 mt-2">You already reviewed this client.</p>
        <div className="mt-4 rounded-lg border border-zinc-800 p-3">
          <div>Rating: {existing.rating}</div>
          {existing.title ? <div>Title: {existing.title}</div> : null}
          {existing.comment ? <div>Comment: {existing.comment}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-4 space-y-3">
      <h1 className="text-xl font-semibold">Review Client</h1>

      <label className="block">
        <div className="text-sm text-zinc-400">Rating (1–5)</div>
        <input
          type="number"
          min="1"
          max="5"
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
          className="w-full bg-black border border-zinc-800 rounded px-3 py-2"
        />
      </label>

      <label className="block">
        <div className="text-sm text-zinc-400">Title</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-black border border-zinc-800 rounded px-3 py-2"
        />
      </label>

      <label className="block">
        <div className="text-sm text-zinc-400">Comment</div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full bg-black border border-zinc-800 rounded px-3 py-2"
          rows={4}
        />
      </label>

      <button
        onClick={submit}
        disabled={busy}
        className="px-4 py-2 rounded bg-gold text-black font-semibold disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit Review"}
      </button>
    </div>
  );
}
