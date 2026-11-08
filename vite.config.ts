import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@shared": r("./src/shared"), "@": r("./src/client") },
  },
  server: {
    // Google sends the browser back to http://localhost:5173/..., so the UI must be on exactly this port.
    // Without strictPort Vite quietly moves to 5174 when 5173 is busy, and the Gmail connection would break.
    port: 5173,
    strictPort: true,
    // Same-origin API in development: run `npm run dev:api` (wrangler dev, port 8787) next to `npm run dev`.
    // In production the Worker serves both the UI and /api, so the browser code never changes.
    proxy: { "/api": { target: "http://127.0.0.1:8787" } },
  },
});
