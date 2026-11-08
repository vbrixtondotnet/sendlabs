import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Same aliases as vite.config.ts, so front-end modules can be unit tested.
  resolve: { alias: { "@shared": r("./src/shared"), "@": r("./src/client") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    // The integration tests start a local workerd (Miniflare) for D1, which takes a few seconds.
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
