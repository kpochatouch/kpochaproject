// apps/web/src/components/ServicePicker.jsx
import { useMemo } from "react";

/**
 * Default unisex salon/beauty catalog (names only).
 * No prices here. If you pass a catalog with prices, set showPrice={true}.
 */
export function getDefaultCatalog() {
  return [
    // Hair (examples)
    { id: "haircut", name: "Haircut" },
    { id: "kids_cut", name: "Kids’ Cut" },
    { id: "beard_trim", name: "Beard Trim / Line Up" },
    { id: "hair_styling", name: "Hair Styling (Men/Women)" },
    { id: "braids_basic", name: "Braids (Basic)" },
    { id: "braids_knotless", name: "Braids (Knotless)" },
    { id: "cornrows", name: "Cornrows" },
    { id: "weave_install", name: "Weave / Wig Install" },
    { id: "locs_maintenance", name: "Dreadlocks Maintenance" },
    { id: "hair_coloring", name: "Hair Coloring / Tint" },

    // Nails & beauty
    { id: "manicure_basic", name: "Manicure (Basic)" },
    { id: "pedicure_basic", name: "Pedicure (Basic)" },
    { id: "nail_fixing", name: "Nail Fixing (Acrylic/PolyGel)" },
    { id: "gel_polish", name: "Gel Polish" },

    // Make-up & lashes
    { id: "makeup_soft", name: "Makeup (Soft Glam)" },
    { id: "makeup_bridal_trial", name: "Makeup (Bridal Trial)" },
    { id: "lashes_classic", name: "Lashes (Classic)" },
    { id: "lashes_volume", name: "Lashes (Volume/Hybrid)" },

    // Skin & spa
    { id: "facial_basic", name: "Facial (Basic)" },
    { id: "massage_relax", name: "Massage (Relaxation)" },

    // Grooming & extras
    { id: "hair_wash", name: "Hair Wash / Blowout" },
    { id: "edge_control", name: "Edge Control / Touch-up" },
  ];
}

/**
 * Props:
 * - value: selected id or name
 * - onChange: (value, meta) => void
 *      meta = { id, name, price? } (price present only if caller's catalog provides it)
 * - catalog: optional [{ id, name, price? }]  // from DB/pro profile; may include price
 * - includeOther: boolean (default true)
 * - otherText: string (controlled)
 * - onOtherText: fn (text)  // updates your controlled otherText
 * - showPrice: boolean (default false) // only shows if your catalog has price
 * - className: string
 * - selectProps: pass-through props for the <select>
 */
export default function ServicePicker({
  value,
  onChange,
  catalog,
  includeOther = true,
  otherText = "",
  onOtherText,
  showPrice = false, // default OFF to avoid any price display unless explicitly requested
  className = "",
  selectProps = {},
}) {
  const items = useMemo(() => {
    const base = Array.isArray(catalog) && catalog.length ? catalog : getDefaultCatalog();
    // de-dup by id
    const seen = new Set();
    return base.filter((it) => {
      if (!it?.id || !it?.name) return false;
      if (seen.has(it.id)) return false;
      seen.add(it.id);
      return true;
    });
  }, [catalog]);

  const selectedIsOther = includeOther && value === "other";

  const formatted = (it) => {
    const hasPrice = Number.isFinite(it?.price);
    if (showPrice && hasPrice) {
      return `${it.name} — ₦${Number(it.price).toLocaleString()}`;
    }
    return it.name;
  };

  function handleSelect(e) {
    const v = e.target.value;
    if (v === "other") {
      onChange?.("other", { id: "other", name: otherText || "", price: null });
      return;
    }
    const found =
      items.find((it) => it.id === v) ||
      items.find((it) => it.name.toLowerCase() === v.toLowerCase());
    onChange?.(v, found || { id: v, name: v });
  }

  function handleOtherText(e) {
    const txt = e.target.value;
    onOtherText?.(txt);
    if (value === "other") {
      onChange?.("other", { id: "other", name: txt, price: null });
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <select
        value={selectedIsOther ? "other" : value || ""}
        onChange={handleSelect}
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
        {...selectProps}
      >
        <option value="" disabled>
          Select a service…
        </option>
        {items.map((it) => (
          <option key={it.id} value={it.id}>
            {formatted(it)}
          </option>
        ))}
        {includeOther && <option value="other">Other (please specify)…</option>}
      </select>

      {includeOther && selectedIsOther && (
        <input
          value={otherText}
          onChange={handleOtherText}
          placeholder="Describe the service…"
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
        />
      )}
    </div>
  );
}
