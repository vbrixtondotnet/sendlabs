import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUnsubscribeToken } from "../../src/server/lib/unsubscribe";
import { startHarness, TEST_KEY, uniqueEmail, type Caller, type Harness } from "./harness";

let h: Harness;
const GLOBEX = "admin@globex.test";
let globexTenantId = "";
let campaignId = "";

beforeAll(async () => {
  h = await startHarness();
  globexTenantId = (await h.addTenant("Globex Corp", GLOBEX)).tenantId;
  campaignId = (await h.api("POST", "/api/campaigns", { name: "Outreach", subject: "S", htmlBody: "<p>x</p>" })).json.id;
});
afterAll(async () => { await h.dispose(); });

const tokenFor = (email: string, over: Partial<{ tenantId: string; campaignId: string | null; test: boolean }> = {}) =>
  createUnsubscribeToken(TEST_KEY, { tenantId: over.tenantId ?? h.tenantId, email, campaignId: over.campaignId === undefined ? campaignId : over.campaignId, test: over.test ?? false });
const info = (token: string, who: Caller = h.anonymous) => who.api("GET", `/api/unsubscribe/${token}`);
const unsubscribe = (token: string, who: Caller = h.anonymous, body?: unknown, headers?: Record<string, string>) => who.api("POST", `/api/unsubscribe/${token}`, body, headers);
const suppressed = (tenantId: string, email: string) => h.rows<{ reason: string; campaign_id: string | null; email: string }>("SELECT reason, campaign_id, email FROM suppressions WHERE tenant_id = ? AND normalized_email = ?", tenantId, email);
const addContact = (email: string, who: Caller = h) => who.api("POST", "/api/contacts", { email, firstName: "Ada" });
const consentOf = async (tenantId: string, email: string) => (await h.rows<{ consent_status: string; consent_source: string | null }>("SELECT consent_status, consent_source FROM contacts WHERE tenant_id = ? AND normalized_email = ?", tenantId, email))[0];

describe("opening an unsubscribe link (GET)", () => {
  it("needs no sign-in, and shows the company and a masked address", async () => {
    const email = uniqueEmail("ada");
    const r = await info(await tokenFor(email));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ companyName: "Sabertooth Software Labs", email: `${email[0]}***${email.slice(email.indexOf("@"))}`, alreadyUnsubscribed: false, test: false });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("never shows the full address", async () => {
    const email = uniqueEmail("private");
    expect(JSON.stringify((await info(await tokenFor(email))).json)).not.toContain(email);
  });

  it("changes NOTHING: a mail scanner that opens every link unsubscribes nobody", async () => {
    const email = uniqueEmail("scan");
    await addContact(email);
    const token = await tokenFor(email);
    for (let i = 0; i < 3; i++) expect((await info(token)).status).toBe(200);
    expect(await suppressed(h.tenantId, email)).toHaveLength(0);
    expect((await consentOf(h.tenantId, email))!.consent_status).toBe("Unknown");
  });

  it("says when the address has already unsubscribed", async () => {
    const email = uniqueEmail("already");
    const token = await tokenFor(email);
    expect((await info(token)).json.alreadyUnsubscribed).toBe(false);
    await unsubscribe(token);
    expect((await info(token)).json.alreadyUnsubscribed).toBe(true);
  });

  it("shows the company's current name", async () => {
    const token = await tokenFor(uniqueEmail("rename"));
    await h.api("PATCH", "/api/tenant", { name: "Sabertooth Renamed" });
    expect((await info(token)).json.companyName).toBe("Sabertooth Renamed");
    await h.api("PATCH", "/api/tenant", { name: "Sabertooth Software Labs" });
  });
});

describe("unsubscribing (POST)", () => {
  it("needs no sign-in, puts the address on the suppression list, and says so", async () => {
    const email = uniqueEmail("out");
    const r = await unsubscribe(await tokenFor(email));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ unsubscribed: true, test: false, companyName: "Sabertooth Software Labs" });
    expect(await suppressed(h.tenantId, email)).toEqual([{ reason: "Unsubscribed", campaign_id: campaignId, email }]);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("marks the contact as having withdrawn consent, and leaves every other contact alone", async () => {
    const email = uniqueEmail("contact");
    const other = uniqueEmail("other");
    await addContact(email);
    await addContact(other);
    await unsubscribe(await tokenFor(email));
    expect(await consentOf(h.tenantId, email)).toEqual({ consent_status: "Withdrawn", consent_source: "Unsubscribe link" });
    expect((await consentOf(h.tenantId, other))!.consent_status).toBe("Unknown");
  });

  it("works for an address that is not a contact (it still goes on the list)", async () => {
    const email = uniqueEmail("stranger");
    expect((await unsubscribe(await tokenFor(email))).status).toBe(200);
    expect(await suppressed(h.tenantId, email)).toHaveLength(1);
  });

  it("works without a campaign in the token", async () => {
    const email = uniqueEmail("nocamp");
    expect((await unsubscribe(await tokenFor(email, { campaignId: null }))).status).toBe(200);
    expect((await suppressed(h.tenantId, email))[0]!.campaign_id).toBeNull();
  });

  it("is idempotent: doing it again is the same as once, with one row and the same answer", async () => {
    const email = uniqueEmail("twice");
    const token = await tokenFor(email);
    const first = await unsubscribe(token);
    const second = await unsubscribe(token);
    expect(second.status).toBe(200);
    expect(second.json).toEqual(first.json);
    expect(await suppressed(h.tenantId, email)).toHaveLength(1);
  });

  it("is what a mail app does for one-click unsubscribe: a form body, no session, and any Origin", async () => {
    const email = uniqueEmail("oneclick");
    const r = await unsubscribe(await tokenFor(email), h.anonymous, "List-Unsubscribe=One-Click", { "content-type": "application/x-www-form-urlencoded" });
    expect(r.status).toBe(200);
    expect(await suppressed(h.tenantId, email)).toHaveLength(1);
    const email2 = uniqueEmail("oneclick-origin");
    expect((await unsubscribe(await tokenFor(email2), h.anonymous, "List-Unsubscribe=One-Click", { "content-type": "application/x-www-form-urlencoded", origin: "https://mail.example.test" })).status).toBe(200);
    expect(await suppressed(h.tenantId, email2)).toHaveLength(1);
  });

  it("does not need a body at all", async () => {
    const email = uniqueEmail("nobody");
    expect((await unsubscribe(await tokenFor(email))).status).toBe(200);
  });

  it("still works for an organization that has been suspended: people can always opt out", async () => {
    const t = await h.addTenant("Suspended Inc", "boss@suspended.test");
    await h.sql("UPDATE tenants SET status = 'Suspended' WHERE id = ?", t.tenantId);
    const email = uniqueEmail("susp");
    expect((await unsubscribe(await tokenFor(email, { tenantId: t.tenantId, campaignId: null }))).status).toBe(200);
    expect(await suppressed(t.tenantId, email)).toHaveLength(1);
  });

  it("is per organization: the same address stays reachable by the others", async () => {
    const email = uniqueEmail("shared");
    await addContact(email);
    await addContact(email, h.as(GLOBEX));
    await unsubscribe(await tokenFor(email));
    expect(await suppressed(h.tenantId, email)).toHaveLength(1);
    expect(await suppressed(globexTenantId, email)).toHaveLength(0);
    expect((await consentOf(h.tenantId, email))!.consent_status).toBe("Withdrawn");
    expect((await consentOf(globexTenantId, email))!.consent_status).toBe("Unknown");
    expect((await info(await tokenFor(email, { tenantId: globexTenantId, campaignId: null }))).json.alreadyUnsubscribed).toBe(false);
  });
});

describe("a link from a test email", () => {
  it("opens the real page and says it is a test", async () => {
    const email = uniqueEmail("qa");
    const r = await info(await tokenFor(email, { test: true }));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ test: true, alreadyUnsubscribed: false, companyName: "Sabertooth Software Labs" });
  });

  it("unsubscribes nobody, and changes nothing", async () => {
    const email = uniqueEmail("qa-post");
    await addContact(email);
    const r = await unsubscribe(await tokenFor(email, { test: true }));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ unsubscribed: false, test: true, companyName: "Sabertooth Software Labs" });
    expect(await suppressed(h.tenantId, email)).toHaveLength(0);
    expect((await consentOf(h.tenantId, email))!.consent_status).toBe("Unknown");
  });

  it("does not show a real unsubscribe as done, even if the address is on the list", async () => {
    const email = uniqueEmail("qa-listed");
    await unsubscribe(await tokenFor(email));
    expect((await info(await tokenFor(email, { test: true }))).json).toMatchObject({ test: true, alreadyUnsubscribed: false });
  });
});

describe("links that are not genuine", () => {
  async function badTokens() {
    const good = await tokenFor(uniqueEmail("good"));
    const [payload, sig] = good.split(".") as [string, string];
    const [otherPayload] = (await tokenFor(uniqueEmail("victim"))).split(".") as [string];
    const unknownTenant = await createUnsubscribeToken(TEST_KEY, { tenantId: "no-such-tenant", email: "a@b.test", campaignId: null, test: false });
    const otherKey = await createUnsubscribeToken(btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 100 + i))), { tenantId: h.tenantId, email: "a@b.test", campaignId: null, test: false });
    return { "junk": "not-a-token", "no dot": "abcdef", "empty signature": `${payload}.`, "swapped payload (someone else's address)": `${otherPayload}.${sig}`, "damaged signature": `${payload}.${sig.slice(0, -2)}AA`, "unknown company": unknownTenant, "signed with another key": otherKey, "too long": `${"a".repeat(2000)}.${sig}` };
  }

  it("all get the same 404, whatever is wrong, so nothing can be learned by guessing", async () => {
    const bad = await badTokens();
    for (const [what, token] of Object.entries(bad)) {
      for (const call of [info, unsubscribe]) {
        const r = await call(token);
        expect(r.status, what).toBe(404);
        expect(r.json.error.code, what).toBe("UNSUBSCRIBE_INVALID");
        expect(r.json.error.message, what).toBe("This unsubscribe link is not valid");
      }
    }
  });

  it("never unsubscribe anyone", async () => {
    const before = (await h.rows<{ n: number }>("SELECT count(*) AS n FROM suppressions"))[0]!.n;
    for (const token of Object.values(await badTokens())) await unsubscribe(token);
    expect((await h.rows<{ n: number }>("SELECT count(*) AS n FROM suppressions"))[0]!.n).toBe(before);
  });
});

describe("a server without a signing key", () => {
  it("answers 503 for the page and the unsubscribe, and does nothing", async () => {
    const token = await tokenFor(uniqueEmail("nokey"));
    const keyless = h.withEnv({ TOKEN_ENCRYPTION_KEY: "" });
    expect((await info(token, keyless)).status).toBe(503);
    const r = await unsubscribe(token, keyless);
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("UNSUBSCRIBE_NOT_CONFIGURED");
  });
});

describe("the suppression list", () => {
  const list = (who: Caller = h, query = "") => who.api("GET", `/api/suppressions${query}`);

  it("shows the people who unsubscribed, newest first, with what an Administrator needs", async () => {
    const t = await h.addTenant("List Co", "boss@listco.test");
    const boss = h.as("boss@listco.test");
    const first = uniqueEmail("first");
    const second = uniqueEmail("second");
    await unsubscribe(await tokenFor(first, { tenantId: t.tenantId, campaignId: null }));
    await h.sql("UPDATE suppressions SET created_at = created_at - 5000 WHERE normalized_email = ?", first);
    await unsubscribe(await tokenFor(second, { tenantId: t.tenantId, campaignId: null }));
    const r = await list(boss);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ total: 2, page: 1, pageSize: 25 });
    expect(r.json.items.map((i: { email: string }) => i.email)).toEqual([second, first]);
    expect(r.json.items[0]).toMatchObject({ email: second, reason: "Unsubscribed" });
    expect(Object.keys(r.json.items[0]).sort()).toEqual(["createdAt", "email", "id", "reason"]);
    expect(new Date(r.json.items[0].createdAt).toISOString()).toBe(r.json.items[0].createdAt);
  });

  it("is empty for an organization nobody unsubscribed from", async () => {
    await h.addTenant("Quiet Co", "boss@quiet.test");
    expect((await list(h.as("boss@quiet.test"))).json).toMatchObject({ items: [], total: 0 });
  });

  it("is paged", async () => {
    const t = await h.addTenant("Paged Co", "boss@paged.test");
    const boss = h.as("boss@paged.test");
    for (let i = 0; i < 3; i++) await unsubscribe(await tokenFor(uniqueEmail(`p${i}`), { tenantId: t.tenantId, campaignId: null }));
    const r = await list(boss, "?page=2&pageSize=2");
    expect(r.json).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(r.json.items).toHaveLength(1);
  });

  it("only ever shows the caller's own organization", async () => {
    const mine = uniqueEmail("mine");
    const theirs = uniqueEmail("theirs");
    await unsubscribe(await tokenFor(mine));
    await unsubscribe(await tokenFor(theirs, { tenantId: globexTenantId, campaignId: null }));
    const ours = JSON.stringify((await list(h, "?pageSize=100")).json);
    expect(ours).toContain(mine);
    expect(ours).not.toContain(theirs);
    expect(JSON.stringify((await list(h.as(GLOBEX), "?pageSize=100")).json)).not.toContain(mine);
  });

  it("is for Administrators only, and needs a session", async () => {
    for (const level of ["campaign-manager", "viewer"]) {
      const email = uniqueEmail(level);
      await h.sql("INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", `u-${email}`, h.tenantId, "M", email, email, "x", level, "Active", 1, 1);
      expect((await list(h.as(email))).status, level).toBe(403);
    }
    expect((await list(h.anonymous)).status).toBe(401);
  });

  it("cannot be changed through the API: it is read-only", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await h.api(method, "/api/suppressions", { email: "a@b.test" })).status, method).toBeGreaterThanOrEqual(400);
    }
    expect((await h.api("DELETE", "/api/suppressions/anything")).status).toBeGreaterThanOrEqual(400);
  });
});
