// apps/web/scripts/generateUniversalList.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The TXT file must be in the same folder as this script
const filePath = path.join(__dirname, "KPOCHA TOUCH — UNIVERSAL PROFESSI.txt");
const text = fs.readFileSync(filePath, "utf8");

function slugify(str) {
  return (
    str
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "item"
  );
}

const lines = text.split(/\r?\n/).map((l) => l.trim());
const categories = {};
let current = null;

// Build { category: [item, item, ...] }
for (const line of lines) {
  if (!line) continue;

  // "1. Hair & Beauty" style headers
  const m = line.match(/^(\d+)\.\s*(.+)$/);
  if (m) {
    current = m[2].trim();
    if (!categories[current]) categories[current] = [];
    continue;
  }

  if (line === "...") continue;
  if (!current) continue;

  categories[current].push(line);
}

// Flatten into one big array with id + category
const out = [];

for (const [category, items] of Object.entries(categories)) {
  const catSlug = slugify(category);
  for (const name of items) {
    const id = `${catSlug}__${slugify(name)}`;
    out.push({ id, name, category });
  }
}

// Build JS file contents
const output = [
  "// AUTO-GENERATED from KPOCHA TOUCH — UNIVERSAL PROFESSI.txt",
  "// Do not edit by hand; re-run scripts/generateUniversalList.js instead.",
  "",
  "export const UNIVERSAL_PROFESSIONS = [",
  ...out.map(
    (it) =>
      `  { id: '${it.id}', name: '${it.name.replace(/'/g, "\\'")}', category: '${it.category.replace(
        /'/g,
        "\\'"
      )}' },`
  ),
  "];",
  "",
].join("\n");

// Write apps/web/scripts/universalList.js
const outPath = path.join(__dirname, "universalList.js");
fs.writeFileSync(outPath, output, "utf8");

console.log("✅ universalList.js generated successfully at:", outPath);
