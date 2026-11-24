import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { loadDevVars } from "../../scripts/lib/env";
import { withDatabase } from "../../scripts/lib/migrations";
import { createApp } from "../../src/server/app";
import { closeDb, createDb, type Database } from "../../src/server/database/client";
import { GoogleOAuth } from "../../src/server/services/google-oauth";
import { provisionTenant } from "../../src/server/services/tenants";

/**
 * Real PostgreSQL, real migrations, real Hono app. Nothing is mocked.
 * Each test file gets a database of its own, copied from a template that already has every migration applied (built once per
 * run by tests/global-setup.ts) and dropped when the file is done. So files running side by side never see each other's data,
 * and the development database is never touched.
 */
export interface Reply { status: number; json: any; headers: Headers }
export type EnvOverride = {
  ENVIRONMENT?: string;
  DEV_ACTOR_EMAIL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  APP_BASE_URL?: string;
  ENABLE_EMAIL_DIAGNOSTICS?: string;
  UNSUBSCRIBE_BASE_URL?: string;
  AUTH_ENABLED?: string;
  EMAIL_PROVIDER?: string;
  POSTMARK_SERVER_TOKEN?: string;
  POSTMARK_FROM?: string;
  POSTMARK_FROM_NAME?: string;
};

/** Google credentials for tests. Fake values, and a throwaway 32-byte key, so the Gmail connection is "configured". */
export const TEST_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const TEST_GOOGLE_ENV: EnvOverride = {
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  TOKEN_ENCRYPTION_KEY: TEST_KEY,
  APP_BASE_URL: "http://localhost:5173",
  // A developer's own .dev.vars (Postmark, diagnostics) must never change what the tests see: these are off unless a test turns them on.
  EMAIL_PROVIDER: "",
  UNSUBSCRIBE_BASE_URL: "",
  AUTH_ENABLED: "",
  POSTMARK_SERVER_TOKEN: "",
  POSTMARK_FROM: "",
  POSTMARK_FROM_NAME: "",
  ENABLE_EMAIL_DIAGNOSTICS: "",
};

export interface Caller {
  /** Call the API as this caller. */
  api: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Reply>;
  /** POST multipart form data (the CSV upload). */
  upload: (form: FormData) => Promise<Reply>;
  /** POST multipart form data to any path (an email with attachments). */
  postForm: (path: string, form: FormData) => Promise<Reply>;
  /** Fetch a raw text response (e.g. a CSV download). */
  text: (path: string) => Promise<{ status: number; body: string; headers: Headers }>;
}

export interface Harness extends Caller {
  env: Env;
  /** The test database, for tests that call repositories directly. One shared client: closed by `dispose`. */
  db: Database;
  /** The default tenant ("Sabertooth Software Labs") and its Administrator, who is the default caller. */
  tenantId: string;
  userId: string;
  adminEmail: string;
  /** A caller with no session and no shortcut user: what a stranger's browser looks like. */
  anonymous: Caller;
  /** Act as another user: pass their email (the placeholder auth resolves the tenant from the user row). */
  as: (email: string) => Caller;
  /** Same as `api` but with env overrides, e.g. { ENVIRONMENT: "production" }. */
  withEnv: (override: EnvOverride) => Caller;
  /** Creates another tenant with its own Administrator. */
  addTenant: (name: string, adminEmail: string) => Promise<{ tenantId: string; userId: string }>;
  /** Run a statement. Write `?` for each bound value, as in SQLite; it is turned into PostgreSQL's `$1`, `$2`... */
  sql: (statement: string, ...params: unknown[]) => Promise<void>;
  /** Run a SELECT and get the rows back. */
  rows: <T = Record<string, unknown>>(statement: string, ...params: unknown[]) => Promise<T[]>;
  dispose: () => Promise<void>;
}

/** `?` placeholders (SQLite style) to PostgreSQL's numbered `$1`, `$2`, ... (the statements here never contain a literal `?`). */
const toPg = (statement: string): string => {
  let n = 0;
  return statement.replace(/\?/g, () => `$${++n}`);
};

export async function startHarness(options: { google?: GoogleOAuth; fetch?: typeof fetch } = {}): Promise<Harness> {
  loadDevVars();
  const testUrl = process.env.TEST_DATABASE_URL;
  const template = process.env.SENDRIX_TEST_TEMPLATE_DB;
  if (!testUrl || !template) {
    throw new Error("Integration tests need PostgreSQL: set TEST_DATABASE_URL in .dev.vars (a login that may create databases). See .dev.vars.example.");
  }

  // A database of this file's own, copied from the template.
  const dbName = `sendrix_t_${randomBytes(6).toString("hex")}`;
  const admin = postgres(testUrl, { max: 1, onnotice: () => {} });
  for (let attempt = 0; ; attempt++) {
    try {
      await admin.unsafe(`CREATE DATABASE ${dbName} TEMPLATE ${template}`);
      break;
    } catch (e) {
      // Another file may be copying the template at this very moment: wait a moment and try again.
      if (attempt >= 20 || !/being accessed by other users|already exists/.test(String((e as Error).message))) throw e;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  const databaseUrl = withDatabase(testUrl, dbName);
  const db = createDb(databaseUrl, { max: 10 });
  const raw = db.$client;

  // What the Worker would be given in development: no Cloudflare bindings, and a database address.
  const env = { ENVIRONMENT: "local", DATABASE_URL: databaseUrl } as unknown as Env;
  const pending = new Set<Promise<unknown>>();
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.add(p); void p.finally(() => pending.delete(p)); }, passThroughOnException: () => {} };

  // The app shares this file's connection pool, so a test makes no new connection per request.
  const app = createApp({ db, ...(options.google ? { google: options.google } : {}), ...(options.fetch ? { fetch: options.fetch } : {}) });
  const reply = async (res: Response): Promise<Reply> => {
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  };
  const fetchWith = (override: EnvOverride, req: Request) =>
    app.fetch(req, { ...env, ...TEST_GOOGLE_ENV, ...override } as unknown as Env, ctx as never);

  const caller = (override: EnvOverride): Caller => ({
    api: async (method, path, body, headers) => {
      const init: RequestInit = { method, headers: { ...headers } };
      if (body !== undefined) {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
        init.headers = { "content-type": "application/json", ...headers };
      }
      return reply(await fetchWith(override, new Request(`http://localhost${path}`, init)));
    },
    postForm: async (path, form) => reply(await fetchWith(override, new Request(`http://localhost${path}`, { method: "POST", body: form }))),
    upload: async (form) => reply(await fetchWith(override, new Request("http://localhost/api/imports", { method: "POST", body: form }))),
    text: async (path) => {
      const res = await fetchWith(override, new Request(`http://localhost${path}`));
      return { status: res.status, body: await res.text(), headers: res.headers };
    },
  });

  // The default tenant and its Administrator: what `npm run db:seed:tenant:local` creates for development.
  const adminEmail = "admin@sabertoothsoftwarelabs.net";
  const seeded = await provisionTenant(db, {
    name: "Sabertooth Software Labs",
    admin: { email: adminEmail, displayName: "Administrator", password: "Password@123" },
  });

  // The shortcut user is opt-in (DEV_ACTOR_EMAIL in .dev.vars), so tests that want it ask for it explicitly.
  const base = caller({ DEV_ACTOR_EMAIL: adminEmail });
  return {
    env,
    db,
    ...base,
    tenantId: seeded.tenantId,
    userId: seeded.userId,
    adminEmail,
    anonymous: caller({}),
    as: (email) => caller({ DEV_ACTOR_EMAIL: email }),
    withEnv: (override) => caller(override),
    addTenant: (name, email) => provisionTenant(db, { name, admin: { email, displayName: name, password: "Password@123" } }),
    sql: async (statement, ...params) => {
      await raw.unsafe(toPg(statement), params as never[]);
    },
    rows: async <T,>(statement: string, ...params: unknown[]) => [...(await raw.unsafe(toPg(statement), params as never[]))] as T[],
    dispose: async () => {
      await Promise.allSettled([...pending]);
      await closeDb(db).catch(() => undefined);
      await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined);
      await admin.end({ timeout: 5 });
    },
  };
}

let counter = 0;
/** A unique, valid email per call so tests never collide. */
export const uniqueEmail = (prefix = "user") => `${prefix}${++counter}.${Date.now().toString(36)}@example.test`;
