// apps/web/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // ⬅️ Ensure only one copy of react & react-dom is bundled (fixes React error #31)
    dedupe: ["react", "react-dom"],
  },
  base: "/",
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2019",
  },
  envPrefix: "VITE_",
});
