//apps/web/src/components/AdvertForm.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useMe } from "../context/MeContext.jsx";
import MediaUploader from "./MediaUploader.jsx";

const GOAL_OPTIONS = [
  { value: "profile_visits", label: "Profile visits" },
  { value: "bookings", label: "Bookings" },
  { value: "messages", label: "Messages" },
];

const GOAL_CONFIG = {
  profile_visits: {
    actionType: "profile",
    buttonLabel: "View Profile",
    helper: "People will open your professional profile.",
  },
  bookings: {
    actionType: "profile",
    buttonLabel: "Book Now",
    helper:
      "People will open your professional profile and can book from there.",
  },
  messages: {
    actionType: "chat",
    buttonLabel: "Send Message",
    helper: "People will go straight into chat with you.",
  },
};

const PLACEMENTS = [
  { value: "feed", label: "Feed" },
  { value: "stories", label: "Stories" },
  { value: "right_rail", label: "Right rail" },
];

const DURATION_OPTIONS = [
  { value: "1d", label: "1 day", days: 1 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
];

function toSafeMedia(initialValue) {
  if (Array.isArray(initialValue?.media) && initialValue.media.length) {
    return [
      {
        assetId: initialValue.media[0]?.assetId || "",
        thumbnailAssetId: initialValue.media[0]?.thumbnailAssetId || null,
        type: initialValue.media[0]?.type || "image",
        url: initialValue.media[0]?.url || "",
      },
    ];
  }

  return [
    {
      assetId: "",
      thumbnailAssetId: null,
      type: "image",
      url: "",
    },
  ];
}

function inferDurationPreset(initialValue) {
  const start = initialValue?.startsAt ? new Date(initialValue.startsAt) : null;
  const end = initialValue?.endsAt ? new Date(initialValue.endsAt) : null;

  if (
    !start ||
    !end ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return "7d";
  }

  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays <= 1) return "1d";
  if (diffDays <= 7) return "7d";
  return "30d";
}

function buildDateRange(
  durationPreset,
  existingStartsAt = "",
  existingEndsAt = "",
  keepExisting = false,
) {
  if (keepExisting && existingStartsAt && existingEndsAt) {
    return {
      startsAt: existingStartsAt,
      endsAt: existingEndsAt,
    };
  }

  const now = new Date();
  const selected =
    DURATION_OPTIONS.find((d) => d.value === durationPreset) ||
    DURATION_OPTIONS[1];
  const end = new Date(now.getTime() + selected.days * 24 * 60 * 60 * 1000);

  return {
    startsAt: now.toISOString(),
    endsAt: end.toISOString(),
  };
}

export default function AdvertForm({
  initialValue = null,
  onSaved,
  submitMode = "create",
}) {
  const { me } = useMe();

  const [title, setTitle] = useState(initialValue?.title || "");
  const [text, setText] = useState(initialValue?.text || "");
  const [goal, setGoal] = useState(initialValue?.goal || "profile_visits");
  const [placements, setPlacements] = useState(
    initialValue?.placements || ["feed"],
  );
  const [durationPreset, setDurationPreset] = useState(
    inferDurationPreset(initialValue),
  );
  const [budget, setBudget] = useState(String(initialValue?.budget || ""));
  const [media, setMedia] = useState(toSafeMedia(initialValue));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [startsAt, setStartsAt] = useState(
    initialValue?.startsAt ? new Date(initialValue.startsAt).toISOString() : "",
  );
  const [endsAt, setEndsAt] = useState(
    initialValue?.endsAt ? new Date(initialValue.endsAt).toISOString() : "",
  );

  const goalConfig = useMemo(() => {
    return GOAL_CONFIG[goal] || GOAL_CONFIG.profile_visits;
  }, [goal]);

  useEffect(() => {
    if (initialValue?._id && startsAt && endsAt) return;

    const next = buildDateRange(durationPreset);
    setStartsAt(next.startsAt);
    setEndsAt(next.endsAt);
  }, [durationPreset, initialValue?._id, startsAt, endsAt]);

  function togglePlacement(value) {
    setPlacements((prev) =>
      prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value],
    );
  }

  async function saveDraft(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");

    try {
      if (!me?.uid) {
        setMsg("You must be signed in.");
        setBusy(false);
        return;
      }

      if (!placements.length) {
        setMsg("Choose at least one placement.");
        setBusy(false);
        return;
      }

      if (!media?.[0]?.assetId) {
        setMsg("Upload advert media first.");
        setBusy(false);
        return;
      }

      const dateRange = buildDateRange(
        durationPreset,
        startsAt,
        endsAt,
        submitMode === "edit" && !!initialValue?._id,
      );

      const payload = {
        title,
        text,
        media: media.map((m) => ({
          assetId: m.assetId,
          thumbnailAssetId: m.thumbnailAssetId || null,
          type: m.type,
        })),
        placements,
        goal,
        actionType: goalConfig.actionType,
        actionValue: me.uid,
        buttonLabel: goalConfig.buttonLabel,
        startsAt: dateRange.startsAt,
        endsAt: dateRange.endsAt,
        budget: Number(budget || 0),
        currency: "NGN",
      };

      let res;
      if (submitMode === "edit" && initialValue?._id) {
        res = await api.patch(`/api/adverts/${initialValue._id}`, payload);
      } else {
        res = await api.post("/api/adverts", payload);
      }

      setStartsAt(res?.data?.advert?.startsAt || dateRange.startsAt);
      setEndsAt(res?.data?.advert?.endsAt || dateRange.endsAt);
      setMsg("Draft saved.");
      onSaved?.(res.data?.advert || null);
    } catch (err) {
      setMsg(err?.response?.data?.error || "Could not save advert.");
    } finally {
      setBusy(false);
    }
  }

  async function submitForReview() {
    if (!initialValue?._id) return;

    setBusy(true);
    setMsg("");
    try {
      await api.patch(`/api/adverts/${initialValue._id}/submit`);
      setMsg("Submitted for review.");
      onSaved?.(initialValue);
    } catch (err) {
      setMsg(err?.response?.data?.error || "Could not submit advert.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={saveDraft} className="space-y-4">
      {msg ? (
        <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
          {msg}
        </div>
      ) : null}

      <label className="block">
        <div className="text-sm mb-1">Title</div>
        <input
          className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Give your advert a short title"
        />
      </label>

      <label className="block">
        <div className="text-sm mb-1">Text</div>
        <textarea
          className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 min-h-[120px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a short advert message"
        />
      </label>

      <label className="block">
        <div className="text-sm mb-1">Goal</div>
        <select
          className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        >
          {GOAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <div className="text-sm mb-1">CTA button</div>
        <select
          className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 text-zinc-300"
          value={goalConfig.buttonLabel}
          disabled
        >
          <option value={goalConfig.buttonLabel}>
            {goalConfig.buttonLabel}
          </option>
        </select>
        <div className="text-xs text-zinc-500 mt-2">{goalConfig.helper}</div>
      </label>

      <div>
        <div className="text-sm mb-2">Placements</div>
        <div className="flex flex-wrap gap-3">
          {PLACEMENTS.map((p) => (
            <label key={p.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={placements.includes(p.value)}
                onChange={() => togglePlacement(p.value)}
              />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
      </div>

      <label className="block">
        <div className="text-sm mb-1">Duration</div>
        <select
          className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2"
          value={durationPreset}
          onChange={(e) => setDurationPreset(e.target.value)}
        >
          {DURATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="text-xs text-zinc-500 mt-2">
          Start and end dates are set automatically from this duration.
        </div>
      </label>

      <div className="block">
        <div className="text-sm mb-2">Media type</div>
        <div className="flex gap-3 mb-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="advert-media-type"
              checked={(media?.[0]?.type || "image") === "image"}
              onChange={() =>
                setMedia([
                  {
                    assetId: "",
                    thumbnailAssetId: null,
                    type: "image",
                    url: "",
                  },
                ])
              }
            />
            <span>Image</span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="advert-media-type"
              checked={media?.[0]?.type === "video"}
              onChange={() =>
                setMedia([
                  {
                    assetId: "",
                    thumbnailAssetId: null,
                    type: "video",
                    url: "",
                  },
                ])
              }
            />
            <span>Video</span>
          </label>
        </div>

        <MediaUploader
          api={api}
          type={media?.[0]?.type || "image"}
          visibility="public"
          valueUrl={media?.[0]?.url || ""}
          valueAssetId={media?.[0]?.assetId || ""}
          label={media?.[0]?.assetId ? "Change Media" : "Add Media"}
          onChange={({ previewUrl, assetId }) => {
            setMedia([
              {
                assetId,
                thumbnailAssetId: null,
                type: media?.[0]?.type || "image",
                url: previewUrl || "",
              },
            ]);
            setMsg("Media uploaded.");
          }}
        />
      </div>

      {media?.[0]?.url ? (
        <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
          {media[0].type === "video" ? (
            <video
              src={media[0].url}
              controls
              className="w-full max-h-96 object-cover"
            />
          ) : (
            <img
              src={media[0].url}
              alt="Advert media"
              className="w-full max-h-96 object-cover"
            />
          )}
        </div>
      ) : null}

      <label className="block">
        <div className="text-sm mb-1">Budget (NGN)</div>
        <input
          type="number"
          className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="Optional for now"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-white text-black px-4 py-2 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save draft"}
        </button>

        <button
          type="button"
          disabled={busy || !initialValue?._id}
          onClick={submitForReview}
          className="rounded-lg border border-zinc-700 px-4 py-2 disabled:opacity-60"
        >
          Submit for review
        </button>
      </div>
    </form>
  );
}
