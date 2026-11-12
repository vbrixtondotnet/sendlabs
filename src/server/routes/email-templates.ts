import { Hono } from "hono";
import { MAX_EMAIL_TEMPLATES, emailTemplateCreateSchema } from "../../shared/schemas";
import { BUILTIN_EMAIL_TEMPLATES } from "../../shared/builtin-templates";
import { unknownTags } from "../../shared/merge";
import type { AppEnv } from "../app";
import { emailTemplatesRepo } from "../database/repositories/email-templates";
import { ApiError, notFound } from "../lib/errors";
import { parseJson } from "../lib/http";
import { requireAccess } from "../middleware/auth";
import { cleanName } from "../services/invitations";

/**
 * Email templates, in two lists:
 *  - Available Templates: made by the system, the same for every organization, read-only here. (Managing them is for a
 *    future global SuperAdministrator; until then they live in builtin-templates.ts.)
 *  - My Templates: the organization's own. Administrators add (a copy of an available one, or a new one) and remove.
 *    Campaign Managers can read them. Viewers have no access to Email Templates at all.
 */
export const emailTemplateRoutes = new Hono<AppEnv>();

emailTemplateRoutes.use("*", requireAccess("Administrator", "Campaign Manager"));

const taken = () => new ApiError(409, "TEMPLATE_NAME_TAKEN", "A template with that name already exists", [{ path: "name", message: "A template with that name already exists" }]);
const tooMany = () => new ApiError(409, "TOO_MANY_TEMPLATES", `You can have at most ${MAX_EMAIL_TEMPLATES} templates`);

/* ----- Available Templates (system). Registered before "/:id" so "available" is not read as an id. ----- */

emailTemplateRoutes.get("/available", (c) => c.json({ items: BUILTIN_EMAIL_TEMPLATES.map((t) => ({ key: t.key, name: t.name })) }));

emailTemplateRoutes.get("/available/:key", (c) => {
  const t = BUILTIN_EMAIL_TEMPLATES.find((x) => x.key === c.req.param("key"));
  if (!t) throw notFound("Template");
  return c.json({ key: t.key, name: t.name, htmlBody: t.htmlBody });
});

/** Copies an available template into My Templates. Adding one that is already there just returns it. */
emailTemplateRoutes.post("/available/:key/add", requireAccess("Administrator"), async (c) => {
  const t = BUILTIN_EMAIL_TEMPLATES.find((x) => x.key === c.req.param("key"));
  if (!t) throw notFound("Template");
  const { tenantId, userId } = c.get("actor");
  const repo = emailTemplatesRepo(c.get("db"), tenantId);
  const existing = await repo.getBySystemKey(t.key);
  if (existing) return c.json(existing);
  if ((await repo.count()) >= MAX_EMAIL_TEMPLATES) throw tooMany();
  const created = await repo.create({ name: t.name, htmlBody: t.htmlBody, createdBy: userId, systemKey: t.key });
  if (!created) {
    // Lost a race to an identical request, or one of the organization's own templates already uses this name.
    const now = await repo.getBySystemKey(t.key);
    if (now) return c.json(now);
    throw taken();
  }
  return c.json(created, 201);
});

/* ----- My Templates ----- */

emailTemplateRoutes.get("/", async (c) => c.json({ items: await emailTemplatesRepo(c.get("db"), c.get("actor").tenantId).list() }));

emailTemplateRoutes.get("/:id", async (c) => {
  const template = await emailTemplatesRepo(c.get("db"), c.get("actor").tenantId).get(c.req.param("id"));
  if (!template) throw notFound("Template");
  return c.json(template);
});

emailTemplateRoutes.post("/", requireAccess("Administrator"), async (c) => {
  const body = await parseJson(c, emailTemplateCreateSchema);
  const { tenantId, userId } = c.get("actor");
  const repo = emailTemplatesRepo(c.get("db"), tenantId);
  const name = cleanName(body.name);
  if (!name) throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", [{ path: "name", message: "Name is required" }]);
  // A typo such as {{frstName}} would be sent as it is: refuse it here, as the campaign editor warns about it.
  const unknown = unknownTags(body.htmlBody);
  if (unknown.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", [{ path: "htmlBody", message: `Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}` }]);
  }
  if ((await repo.count()) >= MAX_EMAIL_TEMPLATES) throw tooMany();
  const created = await repo.create({ name, htmlBody: body.htmlBody.trim(), createdBy: userId });
  if (!created) throw taken();
  return c.json(created, 201);
});

emailTemplateRoutes.delete("/:id", requireAccess("Administrator"), async (c) => {
  if (!(await emailTemplatesRepo(c.get("db"), c.get("actor").tenantId).remove(c.req.param("id")))) throw notFound("Template");
  return c.body(null, 204);
});
