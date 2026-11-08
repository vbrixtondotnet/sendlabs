import { Hono } from "hono";
import { normalizeEmail } from "../../shared/email";
import { MAX_TEST_RECIPIENTS, testRecipientCreateSchema } from "../../shared/schemas";
import type { AppEnv } from "../app";
import { testRecipientsRepo } from "../database/repositories/test-recipients";
import { ApiError, notFound } from "../lib/errors";
import { parseJson } from "../lib/http";
import { requireAccess } from "../middleware/auth";

/**
 * The test-send allowlist. Everyone signed in may read it (the campaign editor shows who a test goes to); only
 * Administrators change it.
 */
export const testRecipientRoutes = new Hono<AppEnv>();

testRecipientRoutes.get("/", async (c) => c.json({ items: await testRecipientsRepo(c.get("db"), c.get("actor").tenantId).list() }));

testRecipientRoutes.post("/", requireAccess("Administrator"), async (c) => {
  const body = await parseJson(c, testRecipientCreateSchema);
  const { tenantId, userId } = c.get("actor");
  const repo = testRecipientsRepo(c.get("db"), tenantId);
  if ((await repo.count()) >= MAX_TEST_RECIPIENTS) {
    throw new ApiError(409, "TOO_MANY_TEST_RECIPIENTS", `The allowlist is limited to ${MAX_TEST_RECIPIENTS} addresses. Remove one first`);
  }
  const row = await repo.add({ email: body.email, normalizedEmail: normalizeEmail(body.email), createdBy: userId });
  if (!row) {
    throw new ApiError(409, "TEST_RECIPIENT_EXISTS", "That address is already on the list", [{ path: "email", message: "That address is already on the list" }]);
  }
  return c.json((await repo.list()).find((r) => r.id === row.id), 201);
});

testRecipientRoutes.delete("/:id", requireAccess("Administrator"), async (c) => {
  if (!(await testRecipientsRepo(c.get("db"), c.get("actor").tenantId).remove(c.req.param("id")))) throw notFound("Address");
  return c.body(null, 204);
});
