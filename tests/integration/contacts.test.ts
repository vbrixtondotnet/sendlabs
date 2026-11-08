import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, uniqueEmail, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.dispose(); });

const mk = (over: Record<string, unknown> = {}) => h.api("POST", "/api/contacts", { email: uniqueEmail(), ...over });

describe("platform", () => {
  it("health is public and reports the database", async () => {
    const r = await h.api("GET", "/api/health");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: "ok", database: "ok" });
  });

  it("fails closed outside the local environment (auth is not built yet)", async () => {
    for (const environment of ["staging", "production"] as const) {
      const r = await h.api("GET", "/api/contacts", undefined, { ENVIRONMENT: environment });
      expect(r.status).toBe(503);
      expect(r.json.error.code).toBe("AUTH_NOT_CONFIGURED");
    }
    const health = await h.api("GET", "/api/health", undefined, { ENVIRONMENT: "production" });
    expect(health.status).toBe(200);
  });

  it("uses one error envelope with a correlation ID that is also a header", async () => {
    const r = await h.api("GET", "/api/nope");
    expect(r.status).toBe(404);
    expect(r.json.error).toMatchObject({ code: "NOT_FOUND" });
    expect(r.json.error.correlationId).toBe(r.headers.get("x-correlation-id"));
  });

  it("rejects malformed JSON and oversized bodies", async () => {
    const bad = await h.api("POST", "/api/contacts", "{not json");
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("INVALID_JSON");
    const big = await h.api("POST", "/api/contacts", JSON.stringify({ email: uniqueEmail(), title: "x".repeat(1_200_000) }));
    expect(big.status).toBe(413);
    expect(big.json.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("contacts", () => {
  it("creates a contact, normalizing the email and filling defaults", async () => {
    const email = uniqueEmail("Nick");
    const r = await mk({ email: `  ${email.toUpperCase()}  `, firstName: "Nick", companyName: "Flexecution", employees: 53, annualRevenue: 16175000 });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      email: email.toLowerCase(),
      firstName: "Nick",
      companyName: "Flexecution",
      employees: 53,
      annualRevenue: 16175000,
      consentStatus: "Unknown",
      industry: "",
    });
    expect(r.json.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(r.json.createdAt).toISOString()).toBe(r.json.createdAt);
  });

  it("rejects a duplicate email in any letter case, pointing at the existing contact", async () => {
    const email = uniqueEmail();
    const first = await mk({ email });
    const dup = await mk({ email: email.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("EMAIL_EXISTS");
    expect(dup.json.error.details.contactId).toBe(first.json.id);
  });

  it("reports validation problems by field without echoing submitted values", async () => {
    const r = await h.api("POST", "/api/contacts", { email: "not-an-email", website: "javascript:alert(1)", employees: -4, secret: "x" });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("VALIDATION_ERROR");
    const text = JSON.stringify(r.json);
    expect(text).not.toContain("javascript:alert");
    expect(text).not.toContain("not-an-email");
    expect(r.json.error.details.length).toBeGreaterThan(0);
  });

  it("gets, and 404s on an unknown id", async () => {
    const c = (await mk()).json;
    expect((await h.api("GET", `/api/contacts/${c.id}`)).json.id).toBe(c.id);
    const missing = await h.api("GET", "/api/contacts/does-not-exist");
    expect(missing.status).toBe(404);
  });

  it("lists with pagination, newest first", async () => {
    const tag = `pg${Date.now().toString(36)}`;
    for (let i = 0; i < 3; i++) await mk({ companyName: tag });
    const p1 = await h.api("GET", `/api/contacts?q=${tag}&pageSize=2&page=1`);
    const p2 = await h.api("GET", `/api/contacts?q=${tag}&pageSize=2&page=2`);
    expect(p1.json).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(p1.json.items).toHaveLength(2);
    expect(p2.json.items).toHaveLength(1);
    const ids = [...p1.json.items, ...p2.json.items].map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(p1.json.items[0].createdAt >= p1.json.items[1].createdAt).toBe(true);
  });

  it("searches name, company, title and email case-insensitively, and filters by industry and consent", async () => {
    const tag = `Zz${Date.now().toString(36)}`;
    await mk({ firstName: "Julie", lastName: tag, companyName: "JC Davis Power", title: "Vice President", industry: "construction", consentStatus: "Granted" });
    await mk({ firstName: "Other", lastName: tag, industry: "retail" });

    const byFull = await h.api("GET", `/api/contacts?q=${encodeURIComponent(`julie ${tag.toLowerCase()}`)}`);
    expect(byFull.json.total).toBe(1); // "first last" search
    expect((await h.api("GET", `/api/contacts?q=${tag.toUpperCase()}`)).json.total).toBe(2);
    expect((await h.api("GET", `/api/contacts?q=${tag}&industry=construction`)).json.total).toBe(1);
    expect((await h.api("GET", `/api/contacts?q=${tag}&consent=Granted`)).json.total).toBe(1);
    expect((await h.api("GET", `/api/contacts?q=davis%20power`)).json.items.length).toBeGreaterThan(0);
  });

  it("treats % and _ in a search literally", async () => {
    const tag = `wc${Date.now().toString(36)}`;
    await mk({ companyName: `${tag}_one` }); // contains a literal underscore
    await mk({ companyName: `${tag}Xone` }); // would match if "_" were a wildcard
    await mk({ companyName: `${tag}100%` }); // contains a literal percent sign
    const count = async (q: string) => (await h.api("GET", `/api/contacts?q=${encodeURIComponent(q)}`)).json.total;

    expect(await count(`${tag}_one`)).toBe(1);
    expect(await count(`${tag}%`)).toBe(0); // "%" is not a wildcard...
    expect(await count(`${tag}100%`)).toBe(1); // ...but matches a real percent sign
    expect(await count("%")).toBe(1); // only the contact that really contains "%"
  });

  it("lists distinct, non-empty industries sorted, and is not mistaken for an id", async () => {
    await mk({ industry: "zz-construction" });
    await mk({ industry: "zz-construction" });
    await mk({ industry: "zz-aerospace" });
    await mk({ industry: "" });
    const r = await h.api("GET", "/api/contacts/industries");
    expect(r.status).toBe(200);
    const mine = r.json.items.filter((i: string) => i.startsWith("zz-"));
    expect(mine).toEqual(["zz-aerospace", "zz-construction"]); // distinct and sorted
    expect(r.json.items).not.toContain("");
  });

  it("rejects bad list parameters", async () => {
    expect((await h.api("GET", "/api/contacts?pageSize=1000")).status).toBe(400);
    expect((await h.api("GET", "/api/contacts?page=0")).status).toBe(400);
    expect((await h.api("GET", "/api/contacts?consent=Maybe")).status).toBe(400);
  });

  it("patches only the given fields and bumps updated_at", async () => {
    const c = (await mk({ firstName: "Old", title: "Keep" })).json;
    await new Promise((r) => setTimeout(r, 5));
    const r = await h.api("PATCH", `/api/contacts/${c.id}`, { firstName: "New", employees: null });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ firstName: "New", title: "Keep" });
    expect(r.json.updatedAt > c.updatedAt).toBe(true);
    expect(r.json.createdAt).toBe(c.createdAt);
  });

  it("re-normalizes a changed email and blocks one that is taken", async () => {
    const a = (await mk()).json;
    const b = (await mk()).json;
    const fresh = uniqueEmail("NewMail");
    const moved = await h.api("PATCH", `/api/contacts/${a.id}`, { email: fresh.toUpperCase() });
    expect(moved.json.email).toBe(fresh.toLowerCase());
    const clash = await h.api("PATCH", `/api/contacts/${b.id}`, { email: fresh });
    expect(clash.status).toBe(409);
    expect(clash.json.error.code).toBe("EMAIL_EXISTS");
  });

  it("rejects empty, unknown-field and not-found patches", async () => {
    const c = (await mk()).json;
    expect((await h.api("PATCH", `/api/contacts/${c.id}`, {})).status).toBe(400);
    expect((await h.api("PATCH", `/api/contacts/${c.id}`, { id: "x" })).status).toBe(400);
    expect((await h.api("PATCH", "/api/contacts/nope", { title: "x" })).status).toBe(404);
  });

  it("deletes, and a deleted contact leaves campaign history intact", async () => {
    const c = (await mk()).json;
    const camp = (await h.api("POST", "/api/campaigns", { name: "History", subject: "s", htmlBody: "<p>b</p>" })).json;
    await h.sql(
      "INSERT INTO campaign_recipients (id,campaign_id,contact_id,email_snapshot,personalization_snapshot,sequence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      "rcp-del-1", camp.id, c.id, c.email, JSON.stringify({ firstName: "Gone" }), 1, Date.now(), Date.now(),
    );
    expect((await h.api("DELETE", `/api/contacts/${c.id}`)).status).toBe(204);
    expect((await h.api("GET", `/api/contacts/${c.id}`)).status).toBe(404);
    expect((await h.api("DELETE", `/api/contacts/${c.id}`)).status).toBe(404);

    const rec = (await h.api("GET", `/api/campaigns/${camp.id}/recipients`)).json.items[0];
    expect(rec.contactId).toBeNull();
    expect(rec.email).toBe(c.email);
    expect(rec.personalization).toEqual({ firstName: "Gone" });
  });
});
