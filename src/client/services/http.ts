import type { ApiErrorBody } from "@shared/api";

/** Any failed API call. `code` is the server's error code, or NETWORK / BAD_RESPONSE for client-side failures. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  /** Field-level problems from a VALIDATION_ERROR, e.g. [{ path: "email", message: "Not a valid email address" }]. */
  get fieldErrors(): { path: string; message: string }[] {
    if (this.code !== "VALIDATION_ERROR" || !Array.isArray(this.details)) return [];
    return this.details.filter(
      (d): d is { path: string; message: string } => typeof d?.path === "string" && typeof d?.message === "string",
    );
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export function withQuery(path: string, params?: QueryParams): string {
  if (!params) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** Thin typed wrapper over fetch. Same-origin, JSON in and out. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    // FormData (the CSV upload) must be sent as-is: the browser sets the multipart boundary itself.
    const init: RequestInit =
      body === undefined ? { method } : body instanceof FormData ? { method, body } : { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } };
    res = await fetch(path, init);
  } catch {
    throw new ApiClientError(0, "NETWORK", "Could not reach the server. Check that the API is running.");
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // fall through to the generic handling below
  }

  if (!res.ok) {
    const err = (data as Partial<ApiErrorBody> | null)?.error;
    if (err && typeof err.code === "string") {
      throw new ApiClientError(res.status, err.code, err.message, err.details, err.correlationId);
    }
    throw new ApiClientError(res.status, "BAD_RESPONSE", `The server returned an unexpected response (${res.status}).`);
  }
  return data as T;
}
