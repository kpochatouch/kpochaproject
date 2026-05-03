// scripts/postinstall.js
const { execSync } = require("child_process");
const fs = require("fs");

const isVercel = !!process.env.VERCEL; // Vercel sets VERCEL=1
if (isVercel) {
  console.log("[postinstall] Vercel detected — skipping patch-package.");
  process.exit(0);
}

const patchEntry = "./node_modules/patch-package/index.js";
if (!fs.existsSync(patchEntry)) {
  console.log("[postinstall] patch-package not found — skipping.");
  process.exit(0);
}

try {
  execSync(`node ${patchEntry}`, { stdio: "inherit" });
} catch (e) {
  console.error("[postinstall] patch-package failed.");
  process.exit(1);
}
