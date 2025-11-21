// Merge your hardcoded salon list + universal professional list
import { UNIVERSAL_PROFESSIONS } from "../../scripts/universalList.js";

// ---- Original salon catalog (the large list you already had) ----
import { getDefaultCatalog } from "../components/ServicePicker.jsx";

// Normalize
function norm(s = "") {
  return String(s).trim().toLowerCase();
}

/**
 * Build final merged + alphabetized universal catalog.
 * All items use:
 *  { id, name, category }
 */
export function buildGlobalCatalog() {
  const salon = getDefaultCatalog().map((x) => ({
    id: x.id,
    name: x.name,
    category: "SALON & BEAUTY",
  }));

  const uni = UNIVERSAL_PROFESSIONS.map((x) => ({
    id: x.id,
    name: x.name,
    category: x.category,
  }));

  const merged = [...salon, ...uni];

  const seen = new Set();
  const out = [];

  for (const item of merged) {
    const key = norm(item.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  // Alphabetical order A → Z
  out.sort((a, b) => a.name.localeCompare(b.name));

  return out;
}
