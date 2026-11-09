import { Hono } from "hono";
import { MAX_EMAIL_TEMPLATES, emailTemplateCreateSchema, templateSelectionSchema } from "../../shared/schemas";
import { unknownTags } from "../../shared/merge";
import type { AppEnv } from "../app";
import { emailTemplatesRepo } from "../database/repositories/email-templates";
import { ApiError, notFound } from "../lib/errors";
import { parseJson } from "../lib/http";
import { requireAccess } from "../middleware/auth";
import { cleanName } from "../services/invitations";

/**
 * The organization's email templates. Everyone signed in may read them (the campaign editor offers the selected ones),
 * Administrators and Campaign Managers choose which are offered, and only Administrators add new ones.
 */
export const emailTemplateRoutes = new Hono<AppEnv>();

emailTemplateRoutes.get("/", async (c) => {
  const repo = emailTemplatesRepo(c.get("db"), c.get("actor").tenantId);
  await repo.ensureBuiltins();
  return c.json({ items: await repo.list() });
});

emailTemplateRoutes.get("/:id", async (c) => {
  const template = await emailTemplatesRepo(c.get("db"), c.get("actor").tenantId).get(c.req.param("id"));
  if (!template) throw notFound("Template");
  return c.json(template);
});

emailTemplateRoutes.post("/", requireAccess("Administrator"), async (c) => {
  const body = await parseJson(c, emailTemplateCreateSchema);
  const { tenantId, userId } = c.get("actor");
  const repo = emailTemplatesRepo(c.get("db"), tenantId);
  await repo.ensureBuiltins(); // so a name that a built-in already uses is reported as taken
  const name = cleanName(body.name);
  if (!name) throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", [{ path: "name", message: "Name is required" }]);
  // A typo such as {{frstName}} would be sent as it is: refuse it here, as the campaign editor warns about it.
  const unknown = unknownTags(body.htmlBody);
  if (unknown.length > 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", [{ path: "htmlBody", message: `Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}` }]);
  }
  if ((await repo.count()) >= MAX_EMAIL_TEMPLATES) {
    throw new ApiError(409, "TOO_MANY_TEMPLATES", `You can have at most ${MAX_EMAIL_TEMPLATES} templates`);
  }
  const created = await repo.create({ name, htmlBody: body.htmlBody.trim(), createdBy: userId });
  if (!created) {
    throw new ApiError(409, "TEMPLATE_NAME_TAKEN", "A template with that name already exists", [{ path: "name", message: "A template with that name already exists" }]);
  }
  return c.json(created, 201);
});

emailTemplateRoutes.put("/:id/selected", requireAccess("Administrator", "Campaign Manager"), async (c) => {
  const { selected } = await parseJson(c, templateSelectionSchema);
  const updated = await emailTemplatesRepo(c.get("db"), c.get("actor").tenantId).setSelected(c.req.param("id"), selected);
  if (!updated) throw notFound("Template");
  return c.json(updated);
});
