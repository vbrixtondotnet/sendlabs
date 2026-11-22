import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, details?: unknown, code = "BAD_REQUEST") =>
  new ApiError(400, code, message, details);
export const notFound = (what: string) => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (message: string, code = "CONFLICT", details?: unknown) =>
  new ApiError(409, code, message, details);

/**
 * PostgreSQL reports a failed constraint with an SQLSTATE code on the error (Drizzle wraps it, so the original is its
 * `cause`): 23505 unique violation, 23503 foreign key, 23514 check, 23502 not null. The message also names the constraint,
 * e.g. `duplicate key value violates unique constraint "users_normalized_email_uq"`.
 */
const sqlState = (err: unknown): string | undefined => {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur instanceof Error; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = cur.cause;
  }
  return undefined;
};
export function isUniqueViolation(err: unknown): boolean {
  return sqlState(err) === "23505";
}
export function isConstraintViolation(err: unknown): boolean {
  return sqlState(err)?.startsWith("23") ?? false;
}
/** The messages of an error and its causes, joined. PostgreSQL names the violated constraint in these. */
export function constraintMessage(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur instanceof Error; i++) {
    parts.push(cur.message);
    const name = (cur as { constraint_name?: unknown }).constraint_name;
    if (typeof name === "string") parts.push(`constraint "${name}"`);
    cur = cur.cause;
  }
  return parts.join(" | ");
}
