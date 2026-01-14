//apps/web/src/pages/LeaveReview.jsx
import { useEffect, useState } from "react";
import {
  useParams,
  useSearchParams,
  useNavigate,
  Link,
} from "react-router-dom";
import { api } from "../lib/api";

function clampRating(n) {
  const v = Number(n) || 0;
  return Math.max(1, Math.min(5, v));
}

export default function LeaveReview() {
  const { proId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const bookingId = searchParams.get("bookingId") || null;

  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState(null);

  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError("");

        // Check if user already has a review for this pro
        const { data } = await api.get(
          `/api/reviews/pro/${encodeURIComponent(proId)}/me`,
        );

        if (!alive) return;

        if (data) {
          setExisting(data);
          setRating(data.rating || 5);
          setTitle(data.title || "");
          setComment(data.comment || "");
        }
      } catch (e) {
        // ignore silently – user can still create a new review
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [proId]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!proId) return;

    setSubmitting(true);
    setError("");
    setOk("");

    try {
      const payload = {
        proId,
        rating: clampRating(rating),
        title: title.trim(),
        comment: comment.trim(),
        // photos: []  // can be added later when you support uploads
      };

      // If an existing review is present, we keep it simple:
      // frontend will prevent extra duplicates by not showing the button again,
      // but backend currently only supports POST, not UPDATE.
      if (existing) {
        // Optional: you could skip POST and just show a message.
        // For strict unique-per-user, we simply block here:
        setError("You have already left a review for this professional.");
        setSubmitting(false);
        return;
      }

      const { data } = await api.post("/api/reviews", payload);

      if (data?.ok) {
        setOk("Review submitted. Thank you!");
        // optional redirect after short delay
        setTimeout(() => {
          if (bookingId) {
            navigate(`/bookings/${bookingId}`, { replace: true });
          } else {
            navigate("/browse", { replace: true });
          }
        }, 1200);
      } else {
        setError(data?.error || "Could not submit review. Please try again.");
      }
    } catch (e) {
      console.error("[LeaveReview] submit error:", e?.response?.data || e);
      setError(
        e?.response?.data?.error ||
          "Could not submit review. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-2">Rate your professional</h1>

      {bookingId && (
        <p className="text-xs text-zinc-500 mb-4">
          This review is linked to your recent booking (
          <code className="text-[10px]">{bookingId}</code>).
        </p>
      )}

      {loading ? (
        <p className="text-zinc-400">Loading…</p>
      ) : (
        <>
          {existing && (
            <div className="mb-4 rounded border border-emerald-800 bg-emerald-900/20 text-emerald-100 px-3 py-2 text-sm">
              You already left a review for this professional. You can adjust
              the rating or text below, but only one review is stored per user
              for now.
            </div>
          )}

          {error && (
            <div className="mb-3 rounded border border-red-800 bg-red-900/30 text-red-100 px-3 py-2 text-sm">
              {error}
            </div>
          )}
          {ok && (
            <div className="mb-3 rounded border border-emerald-800 bg-emerald-900/30 text-emerald-100 px-3 py-2 text-sm">
              {ok}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm mb-1">
                Rating <span className="text-red-500">*</span>
              </label>
              <select
                value={rating}
                onChange={(e) => setRating(e.target.value)}
                className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 text-sm"
                required
              >
                <option value={5}>⭐⭐⭐⭐⭐ – Excellent</option>
                <option value={4}>⭐⭐⭐⭐ – Very good</option>
                <option value={3}>⭐⭐⭐ – Okay</option>
                <option value={2}>⭐⭐ – Poor</option>
                <option value={1}>⭐ – Terrible</option>
              </select>
            </div>

            <div>
              <label className="block text-sm mb-1">Short title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 text-sm"
                placeholder="E.g. 'Great service and friendly'"
              />
            </div>

            <div>
              <label className="block text-sm mb-1">
                Comment (optional but helpful)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 text-sm"
                placeholder="Share what went well, or what could improve. This helps other clients and the professional."
              />
            </div>

            <div className="flex items-center gap-3 mt-2">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-gold text-black px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Submit review"}
              </button>

              {bookingId ? (
                <Link
                  to={`/bookings/${bookingId}`}
                  className="text-xs text-zinc-400 underline"
                >
                  Back to booking
                </Link>
              ) : (
                <Link to="/browse" className="text-xs text-zinc-400 underline">
                  Back to browse
                </Link>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
