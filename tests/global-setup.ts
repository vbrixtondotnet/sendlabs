import postgres from "postgres";
import { loadDevVars } from "../scripts/lib/env";
import { applyAllMigrations, withDatabase } from "../scripts/lib/migrations";

/** The database every test database is copied from: the real migrations, applied once per test run. */
export const TEMPLATE_DB = "sendrix_test_template";

/**
 * Runs once before the tests. Builds the template database from the CURRENT migrations (so tests always see the real schema),
 * and tells the workers where it is. Each integration test file then copies it into a database of its own (tests/integration/
 * harness.ts), which is quick, and means files running side by side never see each other's data.
 *
 * Needs PostgreSQL: TEST_DATABASE_URL in .dev.vars (a login that may create databases). Without it the unit and UI tests still
 * run, and the integration tests fail with a message that says what to set.
 */
export default async function setup() {
  loadDevVars();
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    console.warn("\n[tests] TEST_DATABASE_URL is not set: integration tests need PostgreSQL (see .dev.vars.example).\n");
    return;
  }
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEMPLATE_DB}`);
    const template = postgres(withDatabase(base, TEMPLATE_DB), { max: 1, onnotice: () => {} });
    try {
      await applyAllMigrations(template);
    } finally {
      await template.end({ timeout: 5 });
    }
    process.env.SENDRIX_TEST_TEMPLATE_DB = TEMPLATE_DB;
  } catch (e) {
    console.warn(`\n[tests] Could not prepare the PostgreSQL test database: ${e instanceof Error ? e.message : e}\n`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  // After the run: remove the template and any test database a crashed file left behind.
  return async () => {
    const cleanup = postgres(base, { max: 1, onnotice: () => {} });
    try {
      const leftovers = await cleanup<{ datname: string }[]>`SELECT datname FROM pg_database WHERE (starts_with(datname, 'sendrix_t_') OR datname = ${TEMPLATE_DB}) AND datname <> current_database()`;
      for (const { datname } of leftovers) await cleanup.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    } finally {
      await cleanup.end({ timeout: 5 });
    }
  };
}
