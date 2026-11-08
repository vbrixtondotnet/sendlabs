import { defineConfig } from "drizzle-kit";

// SQLite dialect (Cloudflare D1). Migrations are generated into ./migrations and applied with
// `wrangler d1 migrations apply`, so drizzle-kit never needs database credentials.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/database/schema/index.ts",
  out: "./migrations",
});
