// apps/web/src/components/FollowButton.jsx
import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Props:
 * - targetUid: string | null   (the pro's ownerUid — preferred)
 * - proId:     string | null   (fallback if you follow by proId)
 * - disabled:  boolean         (optional hard disable)
 * - className: string          (optional extra classes)
 */
export default function FollowButton({
  targetUid,
  proId,
  disabled = false,
  className = "",
}) {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  // best-effort initial status
  useEffect(() => {
    let stop = false;
    (async () => {
      if (!targetUid && !proId) return;
      try {
        let res = targetUid
          ? await api.get(`/api/follow/${targetUid}/status`).catch(() => null)
          : null;

        if (!res && targetUid) {
          res = await api
            .get(`/api/follow/status`, { params: { uid: targetUid } })
            .catch(() => null);
        }
        if (!res && proId) {
          res = await api
            .get(`/api/pros/${proId}/follow/status`)
            .catch(() => null);
        }

        const data = res?.data;
        if (!stop && data && typeof data.following === "boolean") {
          setFollowing(data.following);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      stop = true;
    };
  }, [targetUid, proId]);

  async function toggle() {
    if (disabled || busy || (!targetUid && !proId)) return;
    setBusy(true);
    const was = following;
    setFollowing(!was); // optimistic

    try {
      if (!was) {
        if (targetUid) await api.post(`/api/follow/${targetUid}`);
        else await api.post(`/api/pros/${proId}/follow`);
      } else {
        if (targetUid) await api.delete(`/api/follow/${targetUid}`);
        else await api.delete(`/api/pros/${proId}/follow`);
      }
    } catch {
      setFollowing(was); // revert
      alert("Couldn't update follow. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const label = following ? "✔ Following" : "➕ Follow";

  return (
    <button
      onClick={toggle}
      disabled={busy || disabled || (!targetUid && !proId)}
      className={[
        "flex-1 py-2 text-sm flex items-center justify-center gap-1 rounded-none",
        following ? "text-[#F5C542]" : "text-gray-200",
        busy || disabled ? "opacity-60 cursor-not-allowed" : "hover:text-white",
        className,
      ].join(" ")}
      aria-pressed={following}
      aria-busy={busy ? "true" : "false"}
    >
      {label}
    </button>
  );
}
