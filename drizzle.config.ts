import { defineConfig } from "drizzle-kit";

// PostgreSQL. Migrations are generated into ./migrations (`npm run db:generate`) and applied with `npm run db:migrate`
// (src/scripts: scripts/db-migrate.ts), which reads DATABASE_URL, so drizzle-kit itself never needs database credentials.
// The original SQLite/D1 migrations are kept in ./migrations-d1: they define the structure this schema reproduces and are
// the source schema for scripts/migrate-d1-to-postgres.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/database/schema/index.ts",
  out: "./migrations",
});
