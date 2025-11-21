// apps/web/scripts/generateUniversalList.js
// Run with: node apps/web/scripts/generateUniversalList.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the TXT master list (your edited file)
const txtPath = path.join(__dirname, "KPOCHA TOUCH — UNIVERSAL PROFESSI.txt");
const text = fs.readFileSync(txtPath, "utf8");

// ---------- helpers ----------
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

// A heading in your TXT is an ALL-CAPS line like “BEAUTY & PERSONAL CARE”
function isHeading(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // ignore lines that contain lowercase
  if (/[a-z]/.test(trimmed)) return false;
  // we treat anything all-caps (with spaces/&/) as a category
  return true;
}

// ---------- parse the TXT ----------
const lines = text.split(/\r?\n/).map((l) => l.trim());
let currentCategory = null;
const seen = new Set();
const out = [];

for (const line of lines) {
  if (!line) {
    // blank line, just separator
    continue;
  }

  if (isHeading(line)) {
    currentCategory = line; // e.g. "BEAUTY & PERSONAL CARE"
    continue;
  }

  if (!currentCategory) {
    // skip stray lines before first category
    continue;
  }

  const category = currentCategory;
  const name = line;

  const key = `${category}::${name.toLowerCase()}`;
  if (seen.has(key)) continue; // de-dup exact repeats
  seen.add(key);

  const id = `${slugify(category)}__${slugify(name)}`;
  out.push({ id, name, category });
}

// ---------- write universalList.js ----------
const header = `// AUTO-GENERATED from KPOCHA TOUCH — UNIVERSAL PROFESSI.txt
// Do not edit by hand; re-run scripts/generateUniversalList.js instead.

`;

const body =
  "export const UNIVERSAL_PROFESSIONS = [\n" +
  out
    .map(
      (it) =>
        `  { id: '${it.id}', name: '${it.name.replace(/'/g, "\\'")}', category: '${it.category.replace(
          /'/g,
          "\\'"
        )}' },`
    )
    .join("\n") +
  "\n];\n";

const outPath = path.join(__dirname, "universalList.js");
fs.writeFileSync(outPath, header + body, "utf8");

console.log(`✅ universalList.js generated with ${out.length} items at: ${outPath}`);
