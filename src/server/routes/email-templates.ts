import { Hono } from "hono";
import { MAX_EMAIL_TEMPLATES, emailTemplateCreateSchema } from "../../shared/schemas";
import { unknownTags } from "../../shared/merge";
import type { AppEnv } from "../app";
import { emailTemplatesRepo } from "../database/repositories/email-templates";
import { systemTemplatesRepo } from "../database/repositories/system-templates";
import { ApiError, notFound } from "../lib/errors";
import { parseJson } from "../lib/http";
import { requireAccess } from "../middleware/auth";
import { cleanName } from "../services/invitations";

/** At most this many Available Templates: a list a person can scan. */
const MAX_SYSTEM_TEMPLATES = 200;

/**
 * Email templates, in two lists:
 *  - Available Templates: made by the system and shared by every organization. Administrators and Campaign Managers can read
 *    them (an Administrator can copy one into My Templates). Only a SuperAdministrator creates, edits and deletes them.
 *  - My Templates: the organization's own. Administrators add (a copy of an available one, or a new one) and remove.
 *    Campaign Managers can read them. Viewers have no access to Email Templates at all, and a SuperAdministrator, who
 *    belongs to no organization, has no My Templates.
 */
export const emailTemplateRoutes = new Hono<AppEnv>();

emailTemplateRoutes.use("*", requireAccess("Administrator", "Campaign Manager", "SuperAdministrator"));

const readMine = requireAccess("Administrator", "Campaign Manager");
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

/* ----- Available Templates (system). Registered before "/:id" so "available" is not read as an id. ----- */

emailTemplateRoutes.get("/available", async (c) => c.json({ items: await systemTemplatesRepo(c.get("db")).list() }));

emailTemplateRoutes.get("/available/:id", async (c) => {
  const t = await systemTemplatesRepo(c.get("db")).get(c.req.param("id"));
  if (!t) throw notFound("Template");
  return c.json(t);
});

emailTemplateRoutes.post("/available", requireAccess("SuperAdministrator"), async (c) => {
  const input = await templateInput(c);
  const repo = systemTemplatesRepo(c.get("db"));
  if ((await repo.count()) >= MAX_SYSTEM_TEMPLATES) throw tooMany(MAX_SYSTEM_TEMPLATES);
  const created = await repo.create({ ...input, createdBy: c.get("actor").userId });
  if (!created) throw taken();
  return c.json(created, 201);
});

emailTemplateRoutes.put("/available/:id", requireAccess("SuperAdministrator"), async (c) => {
  const input = await templateInput(c);
  const result = await systemTemplatesRepo(c.get("db")).update(c.req.param("id"), input);
  if (result === "missing") throw notFound("Template");
  if (result === "name-taken") throw taken();
  return c.json(result);
});

emailTemplateRoutes.delete("/available/:id", requireAccess("SuperAdministrator"), async (c) => {
  if (!(await systemTemplatesRepo(c.get("db")).remove(c.req.param("id")))) throw notFound("Template");
  return c.body(null, 204);
});

/** Copies an available template into My Templates. Adding one that is already there just returns it. */
emailTemplateRoutes.post("/available/:id/add", requireAccess("Administrator"), async (c) => {
  const t = await systemTemplatesRepo(c.get("db")).get(c.req.param("id"));
  if (!t) throw notFound("Template");
  const { tenantId, userId } = c.get("actor");
  const repo = emailTemplatesRepo(c.get("db"), tenantId);
  const existing = await repo.getBySystemKey(t.id);
  if (existing) return c.json(existing);
  if ((await repo.count()) >= MAX_EMAIL_TEMPLATES) throw tooMany(MAX_EMAIL_TEMPLATES);
  const created = await repo.create({ name: t.name, htmlBody: t.htmlBody, createdBy: userId, systemKey: t.id });
  if (!created) {
    // Lost a race to an identical request, or one of the organization's own templates already uses this name.
    const now = await repo.getBySystemKey(t.id);
    if (now) return c.json(now);
    throw taken();
  }
  return c.json(created, 201);
});

/* ----- My Templates ----- */

emailTemplateRoutes.get("/", readMine, async (c) => c.json({ items: await emailTemplatesRepo(c.get("db"), c.get("actor").tenantId).list() }));

emailTemplateRoutes.get("/:id", readMine, async (c) => {
  const template = await emailTemplatesRepo(c.get("db"), c.get("actor").tenantId).get(c.req.param("id"));
  if (!template) throw notFound("Template");
  return c.json(template);
});

emailTemplateRoutes.post("/", requireAccess("Administrator"), async (c) => {
  const input = await templateInput(c);
  const { tenantId, userId } = c.get("actor");
  const repo = emailTemplatesRepo(c.get("db"), tenantId);
  if ((await repo.count()) >= MAX_EMAIL_TEMPLATES) throw tooMany(MAX_EMAIL_TEMPLATES);
  const created = await repo.create({ ...input, createdBy: userId });
  if (!created) throw taken();
  return c.json(created, 201);
});

emailTemplateRoutes.delete("/:id", requireAccess("Administrator"), async (c) => {
  if (!(await emailTemplatesRepo(c.get("db"), c.get("actor").tenantId).remove(c.req.param("id")))) throw notFound("Template");
  return c.body(null, 204);
});
