import { Hono } from "hono";
import { MAX_EMAIL_TEMPLATES, emailTemplateCreateSchema } from "../../shared/schemas";
import { unknownTags } from "../../shared/merge";
import type { AppEnv } from "../app";
import { emailTemplatesRepo } from "../database/repositories/email-templates";
import { systemTemplatesRepo } from "../database/repositories/system-templates";
import { ApiError, notFound } from "../lib/errors";
import { parseJson } from "../lib/http";
import { cleanName } from "../services/account";

/**
 * Email templates, in two lists:
 *  - Available Templates: starter templates made by the system and shared by every account. READ-ONLY: nothing here creates, edits
 *    or deletes them (they change only by a migration). An account can copy one into its own My Templates.
 *  - My Templates: the signed-in account's own. It adds (a copy of an available one, or a new one), edits and removes them.
 */
export const emailTemplateRoutes = new Hono<AppEnv>();

const taken = () => new ApiError(409, "TEMPLATE_NAME_TAKEN", "A template with that name already exists", [{ path: "name", message: "A template with that name already exists" }]);
const tooMany = (max: number) => new ApiError(409, "TOO_MANY_TEMPLATES", `You can have at most ${max} templates`);

/** A name and message that are fit to store: trimmed, not blank, and with no merge field that does not exist. */
async function templateInput(c: Parameters<typeof parseJson>[0]): Promise<{ name: string; htmlBody: string }> {
  const body = await parseJson(c, emailTemplateCreateSchema);
  const name = cleanName(body.name);
  if (!name) throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", [{ path: "name", message: "Name is required" }]);
  // A typo such as {{frstName}} would be sent as it is: refuse it here, as the campaign editor warns about it.
  const unknown = unknownTags(body.htmlBody);
  if (unknown.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", [{ path: "htmlBody", message: `Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}` }]);
  }
  return { name, htmlBody: body.htmlBody.trim() };
}

/* ----- Available Templates (system, read-only). Registered before "/:id" so "available" is not read as an id. ----- */

emailTemplateRoutes.get("/available", async (c) => c.json({ items: await systemTemplatesRepo(c.get("db")).list() }));

emailTemplateRoutes.get("/available/:id", async (c) => {
  const t = await systemTemplatesRepo(c.get("db")).get(c.req.param("id"));
  if (!t) throw notFound("Template");
  return c.json(t);
});

/** Copies an available template into My Templates. Adding one that is already there just returns it. */
emailTemplateRoutes.post("/available/:id/add", async (c) => {
  const t = await systemTemplatesRepo(c.get("db")).get(c.req.param("id"));
  if (!t) throw notFound("Template");
  const { userId } = c.get("actor");
  const repo = emailTemplatesRepo(c.get("db"), userId);
  const existing = await repo.getBySystemKey(t.id);
  if (existing) return c.json(existing);
  if ((await repo.count()) >= MAX_EMAIL_TEMPLATES) throw tooMany(MAX_EMAIL_TEMPLATES);
  const created = await repo.create({ name: t.name, htmlBody: t.htmlBody, systemKey: t.id });
  if (!created) {
    // Lost a race to an identical request, or one of the account's own templates already uses this name.
    const now = await repo.getBySystemKey(t.id);
    if (now) return c.json(now);
    throw taken();
  }
  return c.json(created, 201);
});

/* ----- My Templates ----- */

emailTemplateRoutes.get("/", async (c) => c.json({ items: await emailTemplatesRepo(c.get("db"), c.get("actor").userId).list() }));

emailTemplateRoutes.get("/:id", async (c) => {
  const template = await emailTemplatesRepo(c.get("db"), c.get("actor").userId).get(c.req.param("id"));
  if (!template) throw notFound("Template");
  return c.json(template);
});

emailTemplateRoutes.post("/", async (c) => {
  const input = await templateInput(c);
  const repo = emailTemplatesRepo(c.get("db"), c.get("actor").userId);
  if ((await repo.count()) >= MAX_EMAIL_TEMPLATES) throw tooMany(MAX_EMAIL_TEMPLATES);
  const created = await repo.create(input);
  if (!created) throw taken();
  return c.json(created, 201);
});

/** Edits one of My Templates (a copy of an Available Template or one the account wrote). Never changes the system version. */
emailTemplateRoutes.put("/:id", async (c) => {
  const input = await templateInput(c);
  const result = await emailTemplatesRepo(c.get("db"), c.get("actor").userId).update(c.req.param("id"), input);
  if (result === "missing") throw notFound("Template");
  if (result === "name-taken") throw taken();
  return c.json(result);
});

emailTemplateRoutes.delete("/:id", async (c) => {
  if (!(await emailTemplatesRepo(c.get("db"), c.get("actor").userId).remove(c.req.param("id")))) throw notFound("Template");
  return c.body(null, 204);
});
