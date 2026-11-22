import { closeDb, createDb } from "../../src/server/database/client";
import { arg, loadDevVars, redact } from "./env";

/** True for an address on this machine. */
export const isLocalUrl = (url: string): boolean => {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

/**
 * Opens the database from `--url` or DATABASE_URL (.dev.vars). With `requireLocal` it refuses any database that is not on this
 * machine: the seed and reset scripts create accounts with a known development password, or delete everything, so they must
 * never be pointed at a staging or production database by a stray setting.
 */
export function openDb(options: { requireLocal?: boolean } = {}) {
  loadDevVars();
  const url = arg("url") ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("No database address: set DATABASE_URL in .dev.vars, or pass --url.");
    process.exit(1);
  }
  if (options.requireLocal && !isLocalUrl(url)) {
    console.error(`Refusing to run against ${redact(url)}: this script only works on a database on this machine.`);
    process.exit(1);
  }
  const db = createDb(url, { max: 1 });
  return { db, url, close: () => closeDb(db) };
}
