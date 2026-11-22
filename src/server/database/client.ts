import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * One typed Drizzle client over PostgreSQL. In the deployed Worker the connection string comes from the Hyperdrive binding
 * (a connection pool in front of the database); in development and tests it is `DATABASE_URL` from `.dev.vars`.
 */
export function createDb(connectionString: string, options: { max?: number } = {}) {
  const client = postgres(connectionString, {
    // A request opens its own connection(s) and closes them at the end: a Worker cannot share sockets between requests.
    max: options.max ?? 5,
    // Safe behind a connection pooler such as Hyperdrive, which may hand a different connection to each statement.
    prepare: false,
    // Skips a type-discovery round trip at the start of every connection.
    fetch_types: false,
    onnotice: () => {},
    types: {
      // Every timestamp is a Unix-millisecond `bigint`. The driver returns bigint as a string by default; a millisecond epoch
      // is far below 2^53, so a plain number is exact and is what the whole app (and the tests) already use.
      bigint: { to: 20, from: [20], parse: (value: string) => Number(value), serialize: (value: unknown) => String(value) },
    },
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

/** What a transaction callback receives: the same query builder, scoped to one transaction. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Either, for code that can run on its own or inside a transaction. */
export type DbOrTx = Database | Transaction;

/** Closes the connections this client opened. Called at the end of a request (or a script). */
export const closeDb = (db: Database): Promise<void> => db.$client.end({ timeout: 5 });

/**
 * The database address for this deployment: the Hyperdrive binding when there is one (production), otherwise `DATABASE_URL`
 * (development, tests, scripts). Throws a clear error when neither is set, so a missing setting is not a mystery.
 */
export function connectionStringFor(env: { HYPERDRIVE?: { connectionString: string } | undefined; DATABASE_URL?: string | undefined }): string {
  const url = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!url) throw new Error("No database is configured: bind HYPERDRIVE, or set DATABASE_URL in .dev.vars");
  return url;
}

export { schema };
