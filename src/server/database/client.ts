import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/** One typed Drizzle client per request. `env.DB` is the D1 binding from wrangler.jsonc. */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;
export { schema };
