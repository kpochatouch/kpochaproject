// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",                // Keep '/' unless you're deploying to a subpath (e.g. '/app/')
  server: {
    port: 5173,             // Local dev port
    host: true,             // Lets you test on phone over LAN (optional)
  },
  build: {
    outDir: "dist",         // Where final files go
    emptyOutDir: true,      // Ensures clean builds
    sourcemap: false,       // Avoid shipping source maps to production
    target: "es2019",       // Broad browser support
  },
  envPrefix: "VITE_",       // Only expose intended vars
});
