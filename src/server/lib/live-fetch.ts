/**
 * What every live job source shares: a typed error, a request cap, "do identical work once", and "stop waiting when the caller
 * goes away". Nothing here stores anything outside memory.
 */

/** Why a call to an outside job source failed, in words that need no knowledge of the transport. Never carries the response body. */
export class JobSourceError extends Error {
  constructor(
    readonly source: string,
    readonly kind: "timeout" | "network" | "http" | "parse" | "rate_limit" | "aborted",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JobSourceError";
  }
}

/** Resolves with `promise`, or rejects at once if `signal` aborts (the caller went away; a shared request carries on for others). */
export function untilAborted<T>(source: string, promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new JobSourceError(source, "aborted", "The request was cancelled"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new JobSourceError(source, "aborted", "The request was cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

/** The same work asked for twice at once is done once: later callers share the first one's promise. */
export function once<T>(running: Map<string, Promise<unknown>>, key: string, work: () => Promise<T>): Promise<T> {
  const already = running.get(key) as Promise<T> | undefined;
  if (already) return already;
  const p = work().finally(() => running.delete(key));
  running.set(key, p);
  return p;
}

/** Counts requests in the last hour. `take` says no (throws) once `max` have been made. */
export class HourlyCap {
  private readonly at: number[] = [];
  constructor(private readonly source: string, private readonly max: number) {}

  take(now: number): void {
    while (this.at.length > 0 && now - this.at[0]! >= 3_600_000) this.at.shift();
    if (this.at.length >= this.max) throw new JobSourceError(this.source, "rate_limit", `Too many requests to ${this.source} just now: try again in a few minutes`);
    this.at.push(now);
  }
}

/** One GET with a timeout, mapped to JobSourceError, returning the parsed JSON. */
export async function getJson(source: string, doFetch: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await doFetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new JobSourceError(source, timedOut ? "timeout" : "network", timedOut ? `${source} did not answer within ${timeoutMs / 1000} seconds` : `Could not reach ${source}`);
  }
  if (!res.ok) throw new JobSourceError(source, "http", `${source} answered ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new JobSourceError(source, "parse", `${source}'s answer was not valid JSON`);
  }
}
