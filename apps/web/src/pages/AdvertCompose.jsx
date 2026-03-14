//apps/web/src/pages/AdvertCompose.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AdvertForm from "../components/AdvertForm.jsx";

export default function AdvertCompose() {
  const navigate = useNavigate();
  const [savedAdvert, setSavedAdvert] = useState(null);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-2">Create Advert</h1>
      <p className="text-zinc-400 mb-6">
        Create your advert with uploaded asset-based media only.
      </p>

      <AdvertForm
        initialValue={savedAdvert}
        submitMode={savedAdvert?._id ? "edit" : "create"}
        onSaved={(advert) => {
          if (advert?._id) {
            setSavedAdvert(advert);
          }
        }}
      />

      {savedAdvert?._id ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => navigate(`/my-adverts?created=${savedAdvert._id}`)}
            className="rounded-lg border border-zinc-700 px-4 py-2"
          >
            Go to My Adverts
          </button>
        </div>
      ) : null}
    </div>
  );
}
