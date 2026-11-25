import { z } from "zod";
import { HourlyCap, JobSourceError, getJson } from "../lib/live-fetch";

/**
 * Hunter.io, for "Get Email Address" (https://hunter.io/api-documentation/v2#domain-search). One call: Domain Search by company name.
 * The API key is part of the request address, so it is never put in an error, a log or an answer (the shared fetch helpers never include
 * the address in a message). Only a click on the button reaches this; answers are cached by the caller.
 */

const ENDPOINT = "https://api.hunter.io/v2/domain-search";
export const MAX_UPSTREAM_PER_HOUR = 20;
/** Below this Hunter confidence an address is not offered. */
export const MIN_CONFIDENCE = 50;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface HunterEmail {
  email: string;
  name: string;
  position: string;
  department: string;
  /** "generic" (careers@...) or "personal". */
  type: string;
  confidence: number;
}

const answer = z.object({
  data: z
    .object({
      emails: z
        .array(
          z.object({
            value: z.string(),
            type: z.string().nullish(),
            confidence: z.number().nullish(),
            first_name: z.string().nullish(),
            last_name: z.string().nullish(),
            position: z.string().nullish(),
            department: z.string().nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

/** How well an address suits a job application: higher is better. */
function rank(e: HunterEmail): number {
  const dept = e.department.toLowerCase();
  const role = e.position.toLowerCase();
  const local = e.email.split("@")[0]!.toLowerCase();
  if (dept === "hr" || /recruit|talent|hiring|human resources|people (?:ops|operations|partner)|\bhr\b/.test(role)) return 5;
  if (dept === "management" || dept === "executive" || /\b(?:founder|owner|ceo|director|manager|head)\b/.test(role)) return 4;
  if (/^(?:careers?|jobs?|hr|recruit(?:ing|ment)?|talent|hiring|apply|people)$/.test(local)) return 3;
  if (/^(?:info|contact|hello|hi|office|team|support|admin|enquiries|inquiries)$/.test(local)) return 1;
  return 2;
}

/** The address to offer: the best-ranked one with enough confidence, ties broken by confidence. Null when there is none. */
export function pickBest(found: HunterEmail[]): HunterEmail | null {
  const ok = found.filter((e) => e.confidence >= MIN_CONFIDENCE && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email));
  ok.sort((a, b) => rank(b) - rank(a) || b.confidence - a.confidence || a.email.localeCompare(b.email));
  return ok[0] ?? null;
}

export const sharedHunterCap = new HourlyCap("Hunter", MAX_UPSTREAM_PER_HOUR);

export interface HunterDeps {
  fetch: typeof fetch;
  apiKey: string;
  timeoutMs?: number;
  now?: () => number;
  cap?: HourlyCap;
}

export class HunterService {
  private readonly cap: HourlyCap;
  private readonly now: () => number;
  constructor(private readonly deps: HunterDeps) {
    this.cap = deps.cap ?? sharedHunterCap;
    this.now = deps.now ?? Date.now;
  }

  /** The emails Hunter knows for a company, by its name. An unknown company is an empty list, not an error. */
  async search(company: string): Promise<HunterEmail[]> {
    this.cap.take(this.now());
    const url = `${ENDPOINT}?company=${encodeURIComponent(company)}&limit=10&api_key=${encodeURIComponent(this.deps.apiKey)}`;
    let raw: unknown;
    try {
      raw = await getJson("Hunter", this.deps.fetch, url, this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    } catch (e) {
      if (e instanceof JobSourceError && e.kind === "http" && (e.status === 400 || e.status === 404)) return []; // no such company
      if (e instanceof JobSourceError && e.kind === "http" && (e.status === 401 || e.status === 403)) throw new JobSourceError("Hunter", "http", "Hunter did not accept the API key", e.status);
      if (e instanceof JobSourceError && e.kind === "http" && (e.status === 429 || e.status === 402)) throw new JobSourceError("Hunter", "rate_limit", "Hunter's search limit has been reached: try again later", e.status);
      throw e;
    }
    const body = answer.safeParse(raw);
    if (!body.success) throw new JobSourceError("Hunter", "parse", "Hunter's answer was not the expected shape");
    return (body.data.data?.emails ?? []).map((e) => ({
      email: e.value.trim().toLowerCase(),
      name: [e.first_name, e.last_name].filter(Boolean).join(" ").trim(),
      position: (e.position ?? "").trim(),
      department: (e.department ?? "").trim(),
      type: (e.type ?? "").trim(),
      confidence: e.confidence ?? 0,
    }));
  }
}
