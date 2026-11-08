import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import { createApp } from "../../src/server/app";
import { createDb } from "../../src/server/database/client";
import { GoogleOAuth } from "../../src/server/services/google-oauth";
import { provisionTenant } from "../../src/server/services/tenants";

/**
 * Real D1 (Miniflare/workerd), real migrations, real Hono app. Nothing is mocked.
 * `persist: false` keeps the database in memory, so tests never touch .wrangler/ dev data.
 */
export interface Reply { status: number; json: any; headers: Headers }
export type EnvOverride = {
  ENVIRONMENT?: string;
  DEV_ACTOR_EMAIL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  APP_BASE_URL?: string;
};

/** Google credentials for tests. Fake values, and a throwaway 32-byte key, so the Gmail connection is "configured". */
export const TEST_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const TEST_GOOGLE_ENV: EnvOverride = {
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  TOKEN_ENCRYPTION_KEY: TEST_KEY,
  APP_BASE_URL: "http://localhost:5173",
};

export interface Caller {
  /** Call the API as this caller. */
  api: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Reply>;
  /** POST multipart form data (the CSV upload). */
  upload: (form: FormData) => Promise<Reply>;
  /** Fetch a raw text response (e.g. a CSV download). */
  text: (path: string) => Promise<{ status: number; body: string; headers: Headers }>;
}

export interface Harness extends Caller {
  env: Env;
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
  sql: (statement: string, ...params: unknown[]) => Promise<void>;
  /** Run a SELECT and get the rows back. */
  rows: <T = Record<string, unknown>>(statement: string, ...params: unknown[]) => Promise<T[]>;
  dispose: () => Promise<void>;
}

/** The migration files in order, each split into its single statements (D1 `prepare` takes one at a time). */
export function migrationFiles(): { name: string; statements: string[] }[] {
  const dir = join(process.cwd(), "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      statements: readFileSync(join(dir, name), "utf8")
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean),
    }));
}

export async function applyMigrations(d1: D1Database, only?: (name: string) => boolean) {
  for (const f of migrationFiles()) {
    if (only && !only(f.name)) continue;
    await d1.batch(f.statements.map((s) => d1.prepare(s)));
  }
}

export async function startHarness(options: { google?: GoogleOAuth } = {}): Promise<Harness> {
  const proxy: PlatformProxy<Env> = await getPlatformProxy<Env>({ persist: false });
  const env = proxy.env;
  await applyMigrations(env.DB);

  const app = createApp(options.google ? { google: options.google } : {});
  const reply = async (res: Response): Promise<Reply> => {
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  };
  const fetchWith = (override: EnvOverride, req: Request) =>
    app.fetch(req, { ...env, ...TEST_GOOGLE_ENV, ...override } as unknown as Env, proxy.ctx as never);

  const caller = (override: EnvOverride): Caller => ({
    api: async (method, path, body, headers) => {
      const init: RequestInit = { method, headers: { ...headers } };
      if (body !== undefined) {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
        init.headers = { "content-type": "application/json", ...headers };
      }
      return reply(await fetchWith(override, new Request(`http://localhost${path}`, init)));
    },
    upload: async (form) => reply(await fetchWith(override, new Request("http://localhost/api/imports", { method: "POST", body: form }))),
    text: async (path) => {
      const res = await fetchWith(override, new Request(`http://localhost${path}`));
      return { status: res.status, body: await res.text(), headers: res.headers };
    },
  });

  // The default tenant and its Administrator: what `npm run db:seed:tenant:local` creates for development.
  const adminEmail = env.DEV_ACTOR_EMAIL ?? "admin@sabertoothsoftwarelabs.net";
  const db = createDb(env.DB);
  const seeded = await provisionTenant(db, {
    name: "Sabertooth Software Labs",
    admin: { email: adminEmail, displayName: "Administrator", password: "Password@123" },
  });

  // The shortcut user is opt-in (DEV_ACTOR_EMAIL in .dev.vars), so tests that want it ask for it explicitly.
  const base = caller({ DEV_ACTOR_EMAIL: adminEmail });
  return {
    env,
    ...base,
    tenantId: seeded.tenantId,
    userId: seeded.userId,
    adminEmail,
    anonymous: caller({}),
    as: (email) => caller({ DEV_ACTOR_EMAIL: email }),
    withEnv: (override) => caller(override),
    addTenant: (name, email) => provisionTenant(db, { name, admin: { email, displayName: name, password: "Password@123" } }),
    sql: async (statement, ...params) => {
      await env.DB.prepare(statement).bind(...params).run();
    },
    rows: async <T,>(statement: string, ...params: unknown[]) => ((await env.DB.prepare(statement).bind(...params).all()).results ?? []) as T[],
    dispose: () => proxy.dispose(),
  };
}

let counter = 0;
/** A unique, valid email per call so tests never collide. */
export const uniqueEmail = (prefix = "user") => `${prefix}${++counter}.${Date.now().toString(36)}@example.test`;
