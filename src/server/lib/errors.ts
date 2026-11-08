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

/** D1 surfaces SQLite constraint failures in the error message (or its cause). */
export function isUniqueViolation(err: unknown): boolean {
  return constraintMessage(err).includes("UNIQUE constraint failed");
}
export function isConstraintViolation(err: unknown): boolean {
  return constraintMessage(err).includes("constraint failed");
}
function constraintMessage(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur instanceof Error; i++) {
    parts.push(cur.message);
    cur = cur.cause;
  }
  return parts.join(" | ");
}
