import { Hono } from "hono";
import { contactEmailLookupSchema, jobApplicationEmailSchema, jobListQuery } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { ApiError } from "../lib/errors";
import { JobSourceError } from "../lib/live-fetch";
import { readAttachments } from "../lib/attachments";
import { parseJson, parseQuery } from "../lib/http";
import { addCompanyContact } from "../services/company-contact";
import { findContactEmail } from "../services/contact-email";
import { HunterService } from "../services/hunter";
import { emailProviderForRequest } from "../services/email-providers";
import { sendApplicationEmail } from "../services/job-application-email";
import { JobSearchService, jobSources } from "../services/job-search";

/**
 * Jobs, live from Remotive, Arbeitnow, Jobicy, Himalayas and (with a key) Jooble, merged: nothing is stored. The browser asks us, we ask the sources (each with a timeout, a
 * short in-memory cache, one shared request for identical searches and an hourly cap: see their services), filter / sort / page the
 * merged list and send it back. Open to every signed-in account: the jobs belong to no account. The request's own abort signal is passed
 * on, so a search the page has already replaced stops being waited for.
 */
export const jobRoutes = new Hono<AppEnv>();

const service = (c: { get: (k: "fetch") => typeof fetch; env: Env }) => new JobSearchService(jobSources(c.get("fetch"), { joobleApiKey: c.env.JOOBLE_API_KEY }));

/** A source failure is a gateway problem, not a bug in ours: say so, in words the page can show. */
async function viaSources<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof JobSourceError) {
      const status = e.kind === "timeout" ? 504 : e.kind === "rate_limit" ? 429 : e.kind === "aborted" ? 408 : 502;
      throw new ApiError(status, e.kind === "rate_limit" ? "JOB_SOURCE_BUSY" : "JOB_SOURCE_UNAVAILABLE", e.message);
    }
    throw e;
  }
}

jobRoutes.get("/", async (c) => {
  const q = parseQuery(c, jobListQuery);
  return c.json(await viaSources(() => service(c).list(q, c.req.raw.signal)));
});
/**
 * Add to Contacts (Hiring Companies card): finds the company's contact person with Hunter.io and adds them to the caller's contacts for
 * COMPANY_CONTACT_COST credits, only when one is found and added (see services/company-contact.ts). Never returns the API key.
 */
jobRoutes.post("/companies/add-contact", async (c) => {
  const { companyName } = await parseJson(c, contactEmailLookupSchema);
  const key = c.env.HUNTER_API_KEY?.trim();
  const hunter = key ? new HunterService({ fetch: c.get("fetch"), apiKey: key }) : null;
  c.header("Cache-Control", "no-store");
  return c.json(await viaSources(() => addCompanyContact(c.get("db"), hunter, { userId: c.get("actor").userId }, companyName)));
});

/** The Hiring Companies panel: the companies in the current search's results, with how many jobs each has there. Same filters as the list. */
jobRoutes.get("/companies", async (c) => c.json(await viaSources(() => service(c).companies(parseQuery(c, jobListQuery), c.req.raw.signal))));
jobRoutes.get("/categories", async (c) => {
  const items = await viaSources(() => service(c).categories(c.req.raw.signal));
  return c.json({ items: items.map(({ value, label }) => ({ value, label })) });
});
/** The description of one job, for the View Job panel: plain text blocks, never markup. `?id=remotive:123`. */
jobRoutes.get("/description", async (c) => {
  const id = (c.req.query("id") ?? "").trim();
  if (id === "" || id.length > 300) throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", [{ path: "id", message: "A job id is required" }]);
  const blocks = await viaSources(() => service(c).description(id, c.req.raw.signal));
  if (!blocks) throw new ApiError(404, "NOT_FOUND", "This job is no longer listed");
  return c.json({ id, blocks });
});
jobRoutes.get("/locations", async (c) => c.json({ items: await viaSources(() => service(c).locations(c.req.raw.signal)) }));

/**
 * Get Email Address (Apply panel): finds the contact email of the job's company with Hunter.io. Only a click calls it. Costs
 * CONTACT_LOOKUP_COST credits, only when an address is found (see services/contact-email.ts). Never returns the API key.
 */
jobRoutes.post("/contact-email", async (c) => {
  const { companyName } = await parseJson(c, contactEmailLookupSchema);
  const key = c.env.HUNTER_API_KEY?.trim();
  const hunter = key ? new HunterService({ fetch: c.get("fetch"), apiKey: key }) : null;
  c.header("Cache-Control", "no-store");
  return c.json(await viaSources(() => findContactEmail(c.get("db"), hunter, { userId: c.get("actor").userId }, companyName)));
});

/**
 * Sends a personally written application email, with PDF / Word attachments, from the Apply panel. One recipient, no CC or BCC.
 */
jobRoutes.post("/apply-email", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Send the email as a form");
  }
  // Only these fields exist. There is no CC or BCC: a form that carries one is refused, not quietly sent without it.
  const unknown = [...new Set([...form.keys()])].filter((k) => !["to", "subject", "body", "attachments"].includes(k));
  if (unknown.length > 0) throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", unknown.map((k) => ({ path: k, message: "This field is not accepted" })));
  const text = (name: string) => (typeof form.get(name) === "string" ? (form.get(name) as string) : "");
  const fields = jobApplicationEmailSchema.parse({ to: text("to"), subject: text("subject"), body: text("body") });
  const files = form.getAll("attachments").filter((v): v is File => typeof v !== "string" && v.size >= 0 && v.name !== "");
  const attachments = await readAttachments(files);

  const actor = c.get("actor");
  await sendApplicationEmail({ email: emailProviderForRequest(c), userId: actor.userId, fallbackFromName: actor.displayName || actor.email }, fields, attachments);
  return c.json({ sent: true, attachments: attachments.length });
});
