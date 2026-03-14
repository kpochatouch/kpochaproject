//apps/web/src/pages/AdvertEdit.jsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import AdvertForm from "../components/AdvertForm.jsx";

export default function AdvertEdit() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [advert, setAdvert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setMsg("");

    try {
      const res = await api.get(`/api/adverts/${id}`);
      setAdvert(res.data || null);
    } catch (err) {
      setMsg(err?.response?.data?.error || "Could not load advert.");
      setAdvert(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div>Loading advert…</div>
      </div>
    );
  }

  if (!advert) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="text-red-400 mb-4">{msg || "Advert not found."}</div>
        <button
          type="button"
          onClick={() => navigate("/my-adverts")}
          className="rounded-lg border border-zinc-700 px-4 py-2"
        >
          Back to My Adverts
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-2">Edit Advert</h1>
      <p className="text-zinc-400 mb-6">
        Update your advert and submit it for review.
      </p>

      {msg ? <div className="mb-4 text-sm text-red-400">{msg}</div> : null}

      <AdvertForm
        initialValue={advert}
        submitMode="edit"
        onSaved={() => {
          navigate("/my-adverts");
        }}
      />
    </div>
  );
}
