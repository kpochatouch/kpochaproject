// apps/web/vite.config.js
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const allowed = [];

  // IMPORTANT: this must be just the host, no protocol, e.g.
  // VITE_NGROK_HOST=50ed8a1728e5.ngrok-free.app
  if (env.VITE_NGROK_HOST) {
    allowed.push(env.VITE_NGROK_HOST);
  }

  return {
    plugins: [react()],
    base: "/",
    server: {
      port: 5173,
      host: true,
      allowedHosts: allowed, // lets ngrok reach your dev server
      proxy: {
        // Anything starting with /api goes to your local Node server
        "/api": {
          target: "http://localhost:8080",
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
      target: "es2019",
    },
    envPrefix: "VITE_",
  };
});
