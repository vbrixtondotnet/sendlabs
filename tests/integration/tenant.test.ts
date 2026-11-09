import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, uniqueEmail, type Harness } from "./harness";

let h: Harness;
const GLOBEX = "admin@globex.test";

beforeAll(async () => {
  h = await startHarness();
  await h.addTenant("Globex Corp", GLOBEX);
});
afterAll(async () => { await h.dispose(); });

const rename = (name: unknown, who: { api: Harness["api"] } = h) => who.api("PATCH", "/api/tenant", { name });
const nameOf = async (tenantId: string) => (await h.rows<{ name: string; slug: string }>("SELECT name, slug FROM tenants WHERE id = ?", tenantId))[0]!;

async function member(accessId: string) {
  const email = uniqueEmail(accessId);
  await h.sql("INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", `u-${email}`, h.tenantId, "M", email, email, "x", accessId, "Active", 1, 1);
  return h.as(email);
}

describe("renaming the organization", () => {
  it("an Administrator can, and the new name shows up in /api/me for everyone in the organization", async () => {
    const r = await rename("Sabertooth Labs International");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: h.tenantId, name: "Sabertooth Labs International", slug: "sabertooth-software-labs" });
    expect((await h.api("GET", "/api/me")).json.tenant.name).toBe("Sabertooth Labs International");
    expect((await (await member("viewer")).api("GET", "/api/me")).json.tenant.name).toBe("Sabertooth Labs International");
    expect((await nameOf(h.tenantId)).name).toBe("Sabertooth Labs International");
  });

  it("leaves the slug alone, so anything that refers to the organization by it keeps working", async () => {
    await rename("Totally Different Name");
    expect((await nameOf(h.tenantId)).slug).toBe("sabertooth-software-labs");
  });

  it("trims and tidies the name", async () => {
    const r = await rename("  Acme\r\n   Holdings\t ");
    expect(r.json.name).toBe("Acme Holdings");
  });

  it("can change only the capital letters of its own name", async () => {
    await rename("Sabertooth Software Labs");
    expect((await rename("SABERTOOTH SOFTWARE LABS")).status).toBe(200);
  });

  it("Campaign Managers and Viewers are refused, and nothing changes", async () => {
    await rename("Stable Name");
    for (const level of ["campaign-manager", "viewer"]) {
      const r = await rename("Hijacked", await member(level));
      expect(r.status, level).toBe(403);
    }
    expect((await nameOf(h.tenantId)).name).toBe("Stable Name");
  });

  it("needs a session", async () => {
    expect((await h.anonymous.api("PATCH", "/api/tenant", { name: "X" })).status).toBe(401);
  });

  it("refuses a cross-site request", async () => {
    expect((await h.api("PATCH", "/api/tenant", { name: "Evil" }, { origin: "https://evil.test" })).status).toBe(403);
  });

  it("rejects empty, blank and over-long names, and anything else in the body", async () => {
    await rename("Valid Name");
    for (const body of [{ name: "" }, { name: "   " }, { name: "x".repeat(101) }, {}, { name: "A", slug: "hacked" }, { name: "A", status: "Suspended" }, { name: "A", id: "other" }, { name: 5 }]) {
      expect((await h.api("PATCH", "/api/tenant", body)).status, JSON.stringify(body).slice(0, 50)).toBe(400);
    }
    expect((await h.api("PATCH", "/api/tenant", "{nope")).status).toBe(400);
    expect((await nameOf(h.tenantId)).name).toBe("Valid Name");
  });

  it("two organizations cannot share a name, ignoring letter case, and the field is named in the error", async () => {
    const r = await rename("globex CORP");
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("TENANT_NAME_TAKEN");
    expect(r.json.error.details).toEqual([{ path: "name", message: "That organization name is already in use" }]);
    expect((await nameOf(h.tenantId)).name).not.toBe("globex CORP");
  });

  it("only ever renames the caller's own organization", async () => {
    await rename("Mine Alone");
    const globex = (await h.rows<{ id: string; name: string }>("SELECT id, name FROM tenants WHERE name = 'Globex Corp'"))[0]!;
    expect(globex.name).toBe("Globex Corp");
    const theirs = await rename("Globex Renamed", h.as(GLOBEX));
    expect(theirs.status).toBe(200);
    expect((await nameOf(h.tenantId)).name).toBe("Mine Alone"); // not touched by their rename
    expect((await nameOf(globex.id)).name).toBe("Globex Renamed");
  });
});

describe("the postal address", () => {
  const set = (postalAddress: unknown, who: { api: Harness["api"] } = h) => who.api("PATCH", "/api/tenant", { postalAddress });
  const addressOf = async (tenantId: string) => (await h.rows<{ postal_address: string }>("SELECT postal_address FROM tenants WHERE id = ?", tenantId))[0]!.postal_address;
  const ADDRESS = "Acme Inc.\n100 Main Street\nSpringfield, IL 62701\nUnited States";

  it("starts empty, and /api/me reports it", async () => {
    const t = await h.addTenant("Fresh Ltd", "boss@fresh.test");
    expect(await addressOf(t.tenantId)).toBe("");
    expect((await h.as("boss@fresh.test").api("GET", "/api/me")).json.tenant.postalAddress).toBe("");
  });

  it("an Administrator saves a multi-line address, and every user of the organization sees it", async () => {
    const r = await set(ADDRESS);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: h.tenantId, postalAddress: ADDRESS });
    expect(await addressOf(h.tenantId)).toBe(ADDRESS);
    expect((await h.api("GET", "/api/me")).json.tenant.postalAddress).toBe(ADDRESS);
    expect((await (await member("viewer")).api("GET", "/api/me")).json.tenant.postalAddress).toBe(ADDRESS);
  });

  it("tidies it: Windows line breaks, stray spaces and blank lines", async () => {
    const r = await set("  Acme Inc.  \r\n\r\n  100   Main Street\r\n\t\r\nSpringfield\u0000  ");
    expect(r.json.postalAddress).toBe("Acme Inc.\n100 Main Street\nSpringfield");
  });

  it("can be cleared again", async () => {
    await set(ADDRESS);
    expect((await set("")).json.postalAddress).toBe("");
    expect(await addressOf(h.tenantId)).toBe("");
    expect((await set("   \n  ")).json.postalAddress).toBe("");
  });

  it("can be sent together with the name, or alone, and changing one leaves the other", async () => {
    await rename("Pair Co");
    await set(ADDRESS);
    expect((await nameOf(h.tenantId)).name).toBe("Pair Co");
    expect(await addressOf(h.tenantId)).toBe(ADDRESS);
    const both = await h.api("PATCH", "/api/tenant", { name: "Pair Co 2", postalAddress: "1 Road" });
    expect(both.json).toMatchObject({ name: "Pair Co 2", postalAddress: "1 Road" });
    await rename("Pair Co 3");
    expect(await addressOf(h.tenantId)).toBe("1 Road"); // renaming does not wipe the address
  });

  it("is refused if the name is taken, and then the address is not changed either (all or nothing)", async () => {
    await set("Original Address");
    const takenName = (await h.rows<{ name: string }>("SELECT t.name FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE u.normalized_email = ?", GLOBEX))[0]!.name;
    const r = await h.api("PATCH", "/api/tenant", { name: takenName, postalAddress: "Should not be saved" });
    expect(r.status).toBe(409);
    expect(await addressOf(h.tenantId)).toBe("Original Address");
  });

  it("rejects an over-long address, wrong types, and an empty request", async () => {
    await set("Keep me");
    for (const body of [{ postalAddress: "x".repeat(501) }, { postalAddress: 5 }, { postalAddress: null }, {}, { postalAddress: "ok", slug: "hacked" }]) {
      expect((await h.api("PATCH", "/api/tenant", body)).status, JSON.stringify(body).slice(0, 50)).toBe(400);
    }
    expect((await set("x".repeat(500))).status).toBe(200); // exactly at the limit is fine
    await set("Keep me");
    expect(await addressOf(h.tenantId)).toBe("Keep me");
  });

  it("only Administrators can change it, and only their own organization's", async () => {
    await set("Mine");
    expect((await set("Hijacked", await member("campaign-manager"))).status).toBe(403);
    expect((await set("Hijacked", await member("viewer"))).status).toBe(403);
    expect(await addressOf(h.tenantId)).toBe("Mine");
    await set("Globex Street 1", h.as(GLOBEX));
    expect(await addressOf(h.tenantId)).toBe("Mine");
    const globex = (await h.rows<{ tenant_id: string }>("SELECT tenant_id FROM users WHERE normalized_email = ?", GLOBEX))[0]!.tenant_id;
    expect(await addressOf(globex)).toBe("Globex Street 1");
  });

  it("does not leak into other tenants' /api/me", async () => {
    await set("Private to us");
    expect(JSON.stringify((await h.as(GLOBEX).api("GET", "/api/me")).json)).not.toContain("Private to us");
  });
});

describe("the website", () => {
  const set = (website: unknown, who: { api: Harness["api"] } = h) => who.api("PATCH", "/api/tenant", { website });
  const websiteOf = async (tenantId: string) => (await h.rows<{ website: string }>("SELECT website FROM tenants WHERE id = ?", tenantId))[0]!.website;

  it("starts empty, and /api/me reports it", async () => {
    const t = await h.addTenant("Web Fresh Ltd", "boss@webfresh.test");
    expect(await websiteOf(t.tenantId)).toBe("");
    expect((await h.as("boss@webfresh.test").api("GET", "/api/me")).json.tenant.website).toBe("");
  });

  it("an Administrator saves it, and everyone in the organization sees it in /api/me", async () => {
    const r = await set("sabertoothsoftwarelabs.net");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: h.tenantId, website: "sabertoothsoftwarelabs.net" });
    expect(await websiteOf(h.tenantId)).toBe("sabertoothsoftwarelabs.net");
    expect((await h.api("GET", "/api/me")).json.tenant.website).toBe("sabertoothsoftwarelabs.net");
    expect((await (await member("viewer")).api("GET", "/api/me")).json.tenant.website).toBe("sabertoothsoftwarelabs.net");
  });

  it("is trimmed, and a full address is kept as typed", async () => {
    expect((await set("  example.com  ")).json.website).toBe("example.com");
    expect((await set("https://www.example.com/about")).json.website).toBe("https://www.example.com/about");
  });

  it("can be cleared again", async () => {
    await set("example.com");
    expect((await set("")).json.website).toBe("");
    expect(await websiteOf(h.tenantId)).toBe("");
    expect((await set("   ")).json.website).toBe("");
  });

  it("can be sent with the name and address, or alone, and changing one leaves the others", async () => {
    await rename("Site Co");
    await set("keep.test");
    await h.api("PATCH", "/api/tenant", { postalAddress: "1 Road" });
    expect((await nameOf(h.tenantId)).name).toBe("Site Co");
    expect(await websiteOf(h.tenantId)).toBe("keep.test");
    const all = await h.api("PATCH", "/api/tenant", { name: "Site Co 2", website: "two.test", postalAddress: "2 Road" });
    expect(all.json).toMatchObject({ name: "Site Co 2", website: "two.test", postalAddress: "2 Road" });
    await rename("Site Co 3");
    expect(await websiteOf(h.tenantId)).toBe("two.test"); // renaming does not wipe it
  });

  it("is refused for a bad value, and nothing else is saved with it (all or nothing)", async () => {
    await set("good.test");
    for (const website of ["not a website", "javascript:alert(1)", "ftp://x.test", "<b>x.test</b>", "nodots", `${"x".repeat(200)}.com`, 5, null]) {
      expect((await set(website)).status, JSON.stringify(website).slice(0, 40)).toBe(400);
    }
    const both = await h.api("PATCH", "/api/tenant", { name: "Should Not Stick", website: "bad one" });
    expect(both.status).toBe(400);
    expect(await websiteOf(h.tenantId)).toBe("good.test");
    expect((await nameOf(h.tenantId)).name).not.toBe("Should Not Stick");
  });

  it("only Administrators can change it, and only their own organization's", async () => {
    await set("mine.test");
    expect((await set("hijack.test", await member("campaign-manager"))).status).toBe(403);
    expect((await set("hijack.test", await member("viewer"))).status).toBe(403);
    expect(await websiteOf(h.tenantId)).toBe("mine.test");
    await set("globex.test", h.as(GLOBEX));
    expect(await websiteOf(h.tenantId)).toBe("mine.test");
  });

  it("does not leak into other organizations' /api/me", async () => {
    await set("private-to-us.test");
    expect(JSON.stringify((await h.as(GLOBEX).api("GET", "/api/me")).json)).not.toContain("private-to-us.test");
  });
});

describe("the unsubscribe settings", () => {
  const set = (body: Record<string, unknown>, who: { api: Harness["api"] } = h) => who.api("PATCH", "/api/tenant", body);
  const rowOf = async (tenantId: string) => (await h.rows<{ require_unsubscribe_link: number; one_click_unsubscribe: number }>("SELECT require_unsubscribe_link, one_click_unsubscribe FROM tenants WHERE id = ?", tenantId))[0]!;

  it("are both ON for a new organization, and /api/me says so", async () => {
    const t = await h.addTenant("Compliance Fresh Ltd", "boss@compfresh.test");
    expect(await rowOf(t.tenantId)).toEqual({ require_unsubscribe_link: 1, one_click_unsubscribe: 1 });
    expect((await h.as("boss@compfresh.test").api("GET", "/api/me")).json.tenant).toMatchObject({ requireUnsubscribeLink: true, oneClickUnsubscribe: true });
  });

  it("an Administrator can turn each off and on, and everyone in the organization sees it in /api/me", async () => {
    const r = await set({ requireUnsubscribeLink: false });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: h.tenantId, requireUnsubscribeLink: false, oneClickUnsubscribe: true });
    expect((await rowOf(h.tenantId)).require_unsubscribe_link).toBe(0);
    expect((await (await member("viewer")).api("GET", "/api/me")).json.tenant).toMatchObject({ requireUnsubscribeLink: false, oneClickUnsubscribe: true });
    expect((await set({ oneClickUnsubscribe: false })).json).toMatchObject({ requireUnsubscribeLink: false, oneClickUnsubscribe: false });
    expect((await set({ requireUnsubscribeLink: true, oneClickUnsubscribe: true })).json).toMatchObject({ requireUnsubscribeLink: true, oneClickUnsubscribe: true });
    expect(await rowOf(h.tenantId)).toEqual({ require_unsubscribe_link: 1, one_click_unsubscribe: 1 });
  });

  it("changing one leaves the other, and the other company details, alone", async () => {
    await set({ name: "Toggle Co", requireUnsubscribeLink: true, oneClickUnsubscribe: true });
    await set({ oneClickUnsubscribe: false });
    expect(await rowOf(h.tenantId)).toEqual({ require_unsubscribe_link: 1, one_click_unsubscribe: 0 });
    expect((await nameOf(h.tenantId)).name).toBe("Toggle Co");
    await rename("Toggle Co 2");
    expect(await rowOf(h.tenantId)).toEqual({ require_unsubscribe_link: 1, one_click_unsubscribe: 0 }); // renaming does not reset them
    await set({ oneClickUnsubscribe: true });
  });

  it("must be true or false, nothing else", async () => {
    await set({ requireUnsubscribeLink: true, oneClickUnsubscribe: true });
    for (const body of [{ requireUnsubscribeLink: "yes" }, { requireUnsubscribeLink: 0 }, { requireUnsubscribeLink: null }, { oneClickUnsubscribe: "false" }, { oneClickUnsubscribe: 1 }]) {
      expect((await set(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await rowOf(h.tenantId)).toEqual({ require_unsubscribe_link: 1, one_click_unsubscribe: 1 });
  });

  it("is all or nothing with the other fields", async () => {
    await set({ requireUnsubscribeLink: true });
    const takenName = (await h.rows<{ name: string }>("SELECT t.name FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE u.normalized_email = ?", GLOBEX))[0]!.name;
    expect((await set({ name: takenName, requireUnsubscribeLink: false })).status).toBe(409);
    expect((await rowOf(h.tenantId)).require_unsubscribe_link).toBe(1);
  });

  it("only Administrators can change them, and only their own organization's", async () => {
    await set({ requireUnsubscribeLink: true });
    expect((await set({ requireUnsubscribeLink: false }, await member("campaign-manager"))).status).toBe(403);
    expect((await set({ requireUnsubscribeLink: false }, await member("viewer"))).status).toBe(403);
    expect((await rowOf(h.tenantId)).require_unsubscribe_link).toBe(1);
    await set({ requireUnsubscribeLink: false }, h.as(GLOBEX));
    expect((await rowOf(h.tenantId)).require_unsubscribe_link).toBe(1);
    const globex = (await h.rows<{ tenant_id: string }>("SELECT tenant_id FROM users WHERE normalized_email = ?", GLOBEX))[0]!.tenant_id;
    expect((await rowOf(globex)).require_unsubscribe_link).toBe(0);
  });
});
