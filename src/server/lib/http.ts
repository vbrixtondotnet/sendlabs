import type { Context } from "hono";
import type { z } from "zod";
import { badRequest } from "./errors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorBody, Page } from "../../shared/api";

/** Zod issues in a compact, client-friendly form. Never echoes the submitted values. */
export function formatIssues(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON", undefined, "INVALID_JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw badRequest("Validation failed", formatIssues(result.error), "VALIDATION_ERROR");
  return result.data;
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  // Hono returns the first value of a repeated key, which is all the schemas accept.
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw badRequest("Invalid query parameters", formatIssues(result.error), "VALIDATION_ERROR");
  return result.data;
}

/** The one error shape every failure uses. */
export function errorResponse(c: Context, status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      correlationId: (c.get("correlationId") as string | undefined) ?? "unknown",
    },
  };
  return c.json(body, status);
}

export const pageOf =<T>(items: T[], total: number, page: number, pageSize: number): Page<T> => ({
  items,
  total,
  page,
  pageSize,
});

export const offsetOf = (page: number, pageSize: number) => (page - 1) * pageSize;

/** Escape LIKE wildcards so user input is matched literally. Use with `ESCAPE '\'`. */
export const likeContains = (term: string) => `%${term.replace(/[\\%_]/g, "\\$&")}%`;

export const iso = (ms: number): string => new Date(ms).toISOString();
export const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));
