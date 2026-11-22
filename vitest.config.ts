import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Same aliases as vite.config.ts, so front-end modules can be unit tested.
  resolve: { alias: { "@shared": r("./src/shared"), "@": r("./src/client") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    // Builds the PostgreSQL template database once per run (see tests/global-setup.ts).
    globalSetup: ["tests/global-setup.ts"],
    // The integration tests each create a PostgreSQL database of their own, which takes a moment.
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
