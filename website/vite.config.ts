import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// `npm run dev` serves the pages with hot reload and sends /api, /auth and
// /media to `wrangler dev` (port 8787), which runs the Worker with local D1 and R2.
export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
      "/media": "http://localhost:8787",
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
