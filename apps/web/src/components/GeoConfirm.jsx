import { useState } from "react";

export default function GeoConfirm({
  value = { address: "", coords: null },
  isDetecting = false,
  onDetect = () => {},
  onChangeAddress = () => {},
  onChangeCoords = () => {},
}) {
  const [lat, setLat] = useState(value?.coords?.lat || "");
  const [lng, setLng] = useState(value?.coords?.lng || "");
  const address = value?.address || "";

  function applyCoords() {
    const nlat = Number(lat), nlng = Number(lng);
    if (Number.isFinite(nlat) && Number.isFinite(nlng)) onChangeCoords({ lat: nlat, lng: nlng });
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm text-zinc-400">Address / Landmark</span>
        <input
          className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
          value={address}
          onChange={(e) => onChangeAddress(e.target.value)}
          placeholder="Street, estate, landmark…"
        />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-sm text-zinc-400">Latitude</span>
          <input
            className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            onBlur={applyCoords}
            placeholder="e.g. 6.5244"
          />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-400">Longitude</span>
          <input
            className="mt-1 w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            onBlur={applyCoords}
            placeholder="e.g. 3.3792"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={onDetect}
            className="w-full px-3 py-2 rounded-lg border border-zinc-700"
            disabled={isDetecting}
          >
            {isDetecting ? "Detecting…" : "Detect GPS"}
          </button>
        </div>
      </div>
    </div>
  );
}
