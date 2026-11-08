import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import { createApp } from "../../src/server/app";

/**
 * Real D1 (Miniflare/workerd), real migrations, real Hono app. Nothing is mocked.
 * `persist: false` keeps the database in memory, so tests never touch .wrangler/ dev data.
 */
export interface Harness {
  env: Env;
  /** Call the API. Pass `env` overrides, e.g. { ENVIRONMENT: "production" }. */
  api: (method: string, path: string, body?: unknown, envOverride?: Partial<Env>) => Promise<{ status: number; json: any; headers: Headers }>;
  /** POST multipart form data (the CSV upload). */
  upload: (form: FormData, envOverride?: Partial<Env>) => Promise<{ status: number; json: any; headers: Headers }>;
  /** Fetch a raw text response (e.g. a CSV download). */
  text: (path: string) => Promise<{ status: number; body: string; headers: Headers }>;
  sql: (statement: string, ...params: unknown[]) => Promise<void>;
  dispose: () => Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const proxy: PlatformProxy<Env> = await getPlatformProxy<Env>({ persist: false });
  const env = proxy.env;

  // Apply the committed migrations exactly as `wrangler d1 migrations apply` would.
  const dir = join(process.cwd(), "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const statements = readFileSync(join(dir, f), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  }

  const app = createApp();
  const api: Harness["api"] = async (method, path, body, envOverride) => {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
      init.headers = { "content-type": "application/json" };
    }
    const res = await app.fetch(new Request(`http://localhost${path}`, init), { ...env, ...envOverride }, proxy.ctx as never);
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  };

  const parse = async (res: Response) => {
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  };
  const upload: Harness["upload"] = async (form, envOverride) =>
    parse(await app.fetch(new Request("http://localhost/api/imports", { method: "POST", body: form }), { ...env, ...envOverride }, proxy.ctx as never));
  const text: Harness["text"] = async (path) => {
    const res = await app.fetch(new Request(`http://localhost${path}`), env, proxy.ctx as never);
    return { status: res.status, body: await res.text(), headers: res.headers };
  };

  return {
    env,
    api,
    upload,
    text,
    sql: async (statement, ...params) => {
      await env.DB.prepare(statement).bind(...params).run();
    },
    dispose: () => proxy.dispose(),
  };
}

let counter = 0;
/** A unique, valid email per call so tests never collide. */
export const uniqueEmail = (prefix = "user") => `${prefix}${++counter}.${Date.now().toString(36)}@example.test`;
