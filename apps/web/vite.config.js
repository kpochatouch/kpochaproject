// apps/web/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  worker: {
    format: "es",
  },
  base: "/",
  server: {
    port: 5173,
    host: true,
  },
  preview: {},
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2019",
  },
  envPrefix: "VITE_",
});
