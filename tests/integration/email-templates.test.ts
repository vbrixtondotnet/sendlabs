import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILTIN_EMAIL_TEMPLATES } from "../../src/shared/builtin-templates";
import { MAX_EMAIL_TEMPLATES } from "../../src/shared/schemas";
import { startHarness, uniqueEmail, type Caller, type Harness } from "./harness";

let h: Harness;
const GLOBEX = "admin@globex.test";

beforeAll(async () => {
  h = await startHarness();
  await h.addTenant("Globex Corp", GLOBEX);
});
afterAll(async () => { await h.dispose(); });

type Summary = { id: string; name: string; builtin: boolean; selected: boolean; createdAt: string };
const list = async (who: Caller = h) => (await who.api("GET", "/api/email-templates")).json.items as Summary[];
const create = (body: unknown, who: Caller = h) => who.api("POST", "/api/email-templates", body);
const select = (id: string, selected: unknown, who: Caller = h) => who.api("PUT", `/api/email-templates/${id}/selected`, { selected });
const byName = async (name: string, who: Caller = h) => (await list(who)).find((t) => t.name === name)!;
const BODY = "<p>Hi {{firstName}}, this is for {{companyName}}.</p>";

async function member(accessId: string) {
  const email = uniqueEmail(accessId);
  await h.sql("INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", `u-${email}`, h.tenantId, "M", email, email, "x", accessId, "Active", 1, 1);
  return h.as(email);
}

describe("the built-in templates", () => {
  it("are the nine from the Email Templates folder", () => {
    expect(BUILTIN_EMAIL_TEMPLATES.map((t) => t.name)).toEqual([
      "Automotive Services", "Construction", "Digital Marketing", "Food & Beverage Manufacturing", "Healthcare Administration",
      "Professional Services", "Property Management", "Transportation & Logistics", "Wholesale & Distribution",
    ]);
  });

  it("are in every organization's list the first time it is opened, none of them picked yet", async () => {
    const items = await list();
    expect(items).toHaveLength(9);
    expect(items.every((t) => t.builtin && !t.selected)).toBe(true);
    expect(items.map((t) => t.name).sort()).toEqual(BUILTIN_EMAIL_TEMPLATES.map((t) => t.name).sort());
    expect(Object.keys(items[0]!).sort()).toEqual(["builtin", "createdAt", "id", "name", "selected"]); // no body in the list
    expect(new Date(items[0]!.createdAt).toISOString()).toBe(items[0]!.createdAt);
  });

  it("are only added once, however often the list is opened, even all at the same moment", async () => {
    const t = await h.addTenant("Racing Co", "boss@racing.test");
    const boss = h.as("boss@racing.test");
    await Promise.all([1, 2, 3, 4, 5].map(() => list(boss)));
    await list(boss);
    const rows = await h.rows<{ n: number }>("SELECT count(*) AS n FROM email_templates WHERE tenant_id = ?", t.tenantId);
    expect(rows[0]!.n).toBe(9);
  });

  it("are the organization's own copies: each organization has its own set, with its own picks", async () => {
    const mine = await byName("Construction");
    await select(mine.id, true);
    const theirs = await byName("Construction", h.as(GLOBEX));
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.selected).toBe(false);
    expect((await byName("Construction")).selected).toBe(true);
    await select(mine.id, false);
  });

  it("have the exact text of the files, ready to use", async () => {
    for (const t of BUILTIN_EMAIL_TEMPLATES) {
      const got = (await h.api("GET", `/api/email-templates/${(await byName(t.name)).id}`)).json;
      expect(got.htmlBody, t.name).toBe(t.htmlBody);
      expect(got.htmlBody).toContain("{{firstName}}");
      expect(got.htmlBody).toContain("{{companyName}}");
    }
  });

  it("get their text from the files in the Email Templates folder (run `npm run build:templates` after editing one)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const files = readdirSync("Email Templates").filter((f) => f.endsWith(".txt"));
    expect(files).toHaveLength(BUILTIN_EMAIL_TEMPLATES.length);
    for (const f of files) {
      const name = f.replace(/\.txt$/, "");
      const text = readFileSync(`Email Templates/${f}`, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
      expect(BUILTIN_EMAIL_TEMPLATES.find((t) => t.name === name)?.htmlBody, name).toBe(text);
    }
  });

  it("only use merge fields that exist", async () => {
    const { unknownTags } = await import("../../src/shared/merge");
    for (const t of BUILTIN_EMAIL_TEMPLATES) expect(unknownTags(t.htmlBody), t.name).toEqual([]);
  });
});

describe("reading templates", () => {
  it("everyone signed in can read the list and one template, with its body", async () => {
    for (const level of ["campaign-manager", "viewer"]) {
      const who = await member(level);
      expect(await list(who), level).toHaveLength(9);
      const one = await byName("Digital Marketing", who);
      const r = await who.api("GET", `/api/email-templates/${one.id}`);
      expect(r.status, level).toBe(200);
      expect(r.json).toMatchObject({ id: one.id, name: "Digital Marketing", builtin: true });
      expect(typeof r.json.htmlBody).toBe("string");
    }
  });

  it("is private to the organization: another organization's template is a 404", async () => {
    const theirs = await byName("Construction", h.as(GLOBEX));
    expect((await h.api("GET", `/api/email-templates/${theirs.id}`)).status).toBe(404);
    expect((await h.api("GET", "/api/email-templates/does-not-exist")).status).toBe(404);
  });

  it("needs a session", async () => {
    expect((await h.anonymous.api("GET", "/api/email-templates")).status).toBe(401);
    expect((await h.anonymous.api("GET", `/api/email-templates/${(await list())[0]!.id}`)).status).toBe(401);
  });
});

describe("adding a template", () => {
  it("lets an Administrator add one: it is theirs, not built in, not picked yet, and has the body as written", async () => {
    const r = await create({ name: "  Our own  pitch ", htmlBody: `  ${BODY}  ` });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ name: "Our own pitch", builtin: false, selected: false, htmlBody: BODY });
    expect(r.json.id).toBeTruthy();
    const listed = await byName("Our own pitch");
    expect(listed).toMatchObject({ id: r.json.id, builtin: false, selected: false });
    expect((await h.api("GET", `/api/email-templates/${r.json.id}`)).json.htmlBody).toBe(BODY);
    const [row] = await h.rows<{ created_by: string; builtin_key: string | null }>("SELECT created_by, builtin_key FROM email_templates WHERE id = ?", r.json.id);
    expect(row).toEqual({ created_by: h.userId, builtin_key: null });
  });

  it("puts it after the built-in ones in the list", async () => {
    await create({ name: "AAA first alphabetically", htmlBody: BODY });
    const names = (await list()).map((t) => t.name);
    expect(names.indexOf("AAA first alphabetically")).toBeGreaterThanOrEqual(9);
  });

  it("is for Administrators only", async () => {
    for (const level of ["campaign-manager", "viewer"]) {
      const r = await create({ name: `By ${level}`, htmlBody: BODY }, await member(level));
      expect(r.status, level).toBe(403);
    }
    expect((await list()).some((t) => t.name.startsWith("By "))).toBe(false);
    expect((await create({ name: "x", htmlBody: BODY }, h.anonymous)).status).toBe(401);
  });

  it("refuses a name that is already used, ignoring letter case, including a built-in's, and names the field", async () => {
    await create({ name: "Taken Name", htmlBody: BODY });
    for (const name of ["taken name", "TAKEN NAME", "construction", "Wholesale & Distribution"]) {
      const r = await create({ name, htmlBody: BODY });
      expect(r.status, name).toBe(409);
      expect(r.json.error.code).toBe("TEMPLATE_NAME_TAKEN");
      expect(r.json.error.details).toEqual([{ path: "name", message: "A template with that name already exists" }]);
    }
  });

  it("lets two organizations use the same name", async () => {
    expect((await create({ name: "Shared Name", htmlBody: BODY })).status).toBe(201);
    expect((await create({ name: "Shared Name", htmlBody: BODY }, h.as(GLOBEX))).status).toBe(201);
  });

  it("refuses an empty or blank name, an over-long one, and a missing or empty message", async () => {
    const bad: [string, unknown][] = [
      ["no name", { htmlBody: BODY }],
      ["empty name", { name: "", htmlBody: BODY }],
      ["blank name", { name: "   ", htmlBody: BODY }],
      ["long name", { name: "x".repeat(101), htmlBody: BODY }],
      ["no message", { name: "N1" }],
      ["empty message", { name: "N2", htmlBody: "" }],
      ["blank message", { name: "N3", htmlBody: "<p>&nbsp;</p>" }],
      ["spaces only", { name: "N4", htmlBody: "  \n " }],
      ["huge message", { name: "N5", htmlBody: "x".repeat(200_001) }],
      ["name not text", { name: 5, htmlBody: BODY }],
      ["message not text", { name: "N6", htmlBody: ["<p>x</p>"] }],
      ["extra field", { name: "N7", htmlBody: BODY, builtin: true }],
      ["tenant smuggled in", { name: "N8", htmlBody: BODY, tenantId: "other" }],
      ["selected smuggled in", { name: "N9", htmlBody: BODY, selected: true }],
    ];
    for (const [what, body] of bad) expect((await create(body)).status, what).toBe(400);
    expect((await h.api("POST", "/api/email-templates", "{nope")).status).toBe(400);
    expect((await list()).some((t) => /^N\d$/.test(t.name))).toBe(false);
  });

  it("accepts the longest name and a long message", async () => {
    expect((await create({ name: "n".repeat(100), htmlBody: BODY })).status).toBe(201);
    expect((await create({ name: "Long one", htmlBody: `<p>${"x".repeat(150_000)}</p>` })).status).toBe(201);
  });

  it("refuses a merge field that does not exist, and says which", async () => {
    const r = await create({ name: "Typo", htmlBody: "<p>Hi {{frstName}} and {{companyNmae}}</p>" });
    expect(r.status).toBe(400);
    expect(r.json.error.details).toEqual([{ path: "htmlBody", message: "Unknown merge fields: {{frstName}}, {{companyNmae}}" }]);
    expect((await create({ name: "Fine", htmlBody: "<p>{{firstName}} {{lastName}} {{title}} {{unsubscribeUrl}}</p>" })).status).toBe(201);
  });

  it("is limited in size, and says so", async () => {
    const t = await h.addTenant("Full Co", "boss@full.test");
    const boss = h.as("boss@full.test");
    await list(boss); // the nine built-ins
    for (let i = 0; i < MAX_EMAIL_TEMPLATES - 9; i++) {
      await h.sql("INSERT INTO email_templates (id,tenant_id,name,html_body,selected,created_at,updated_at) VALUES (?,?,?,?,0,1,1)", `fill-${i}`, t.tenantId, `Filler ${i}`, BODY);
    }
    const r = await create({ name: "One too many", htmlBody: BODY }, boss);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("TOO_MANY_TEMPLATES");
  });

  it("refuses a cross-site request", async () => {
    expect((await h.api("POST", "/api/email-templates", { name: "Evil", htmlBody: BODY }, { origin: "https://evil.test" })).status).toBe(403);
    expect((await list()).some((t) => t.name === "Evil")).toBe(false);
  });

  it("is added to its own organization only", async () => {
    await create({ name: "Only Ours", htmlBody: BODY });
    expect((await list(h.as(GLOBEX))).some((t) => t.name === "Only Ours")).toBe(false);
  });
});

describe("picking templates for the campaign dropdown", () => {
  it("picks one, and puts it back", async () => {
    const t = await byName("Property Management");
    const on = await select(t.id, true);
    expect(on.status).toBe(200);
    expect(on.json).toMatchObject({ id: t.id, name: "Property Management", selected: true, builtin: true });
    expect((await byName("Property Management")).selected).toBe(true);
    const off = await select(t.id, false);
    expect(off.json.selected).toBe(false);
    expect((await byName("Property Management")).selected).toBe(false);
  });

  it("is the same answer when asked twice", async () => {
    const t = await byName("Healthcare Administration");
    await select(t.id, true);
    expect((await select(t.id, true)).json.selected).toBe(true);
    await select(t.id, false);
  });

  it("works for a template an Administrator added too", async () => {
    const made = (await create({ name: "Pick me", htmlBody: BODY })).json;
    expect((await select(made.id, true)).json).toMatchObject({ id: made.id, selected: true, builtin: false });
  });

  it("changes nothing else about the template", async () => {
    const t = await byName("Professional Services");
    const before = (await h.api("GET", `/api/email-templates/${t.id}`)).json;
    await select(t.id, true);
    const after = (await h.api("GET", `/api/email-templates/${t.id}`)).json;
    expect({ ...after, selected: before.selected }).toEqual(before);
    await select(t.id, false);
  });

  it("is open to Administrators and Campaign Managers, not Viewers", async () => {
    const t = await byName("Automotive Services");
    expect((await select(t.id, true, await member("viewer"))).status).toBe(403);
    expect((await byName("Automotive Services")).selected).toBe(false);
    expect((await select(t.id, true, await member("campaign-manager"))).status).toBe(200);
    expect((await byName("Automotive Services")).selected).toBe(true); // shared by the whole organization
    expect((await select(t.id, false, await member("campaign-manager"))).status).toBe(200);
    expect((await select(t.id, true, h.anonymous)).status).toBe(401);
  });

  it("is shared by everyone in the organization, and only that organization", async () => {
    const t = await byName("Digital Marketing");
    await select(t.id, true);
    expect((await byName("Digital Marketing", await member("viewer"))).selected).toBe(true);
    expect((await byName("Digital Marketing", h.as(GLOBEX))).selected).toBe(false);
    await select(t.id, false);
  });

  it("must say true or false, and nothing else", async () => {
    const t = await byName("Construction");
    for (const body of [{}, { selected: "yes" }, { selected: 1 }, { selected: null }, { selected: true, name: "Hijack" }]) {
      expect((await h.api("PUT", `/api/email-templates/${t.id}/selected`, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await byName("Construction")).name).toBe("Construction");
  });

  it("cannot touch another organization's template, or one that does not exist", async () => {
    const theirs = await byName("Construction", h.as(GLOBEX));
    expect((await select(theirs.id, true)).status).toBe(404);
    expect((await byName("Construction", h.as(GLOBEX))).selected).toBe(false);
    expect((await select("does-not-exist", true)).status).toBe(404);
  });

  it("refuses a cross-site request", async () => {
    const t = await byName("Construction");
    expect((await h.api("PUT", `/api/email-templates/${t.id}/selected`, { selected: true }, { origin: "https://evil.test" })).status).toBe(403);
  });
});

describe("what the table allows", () => {
  it("cannot hold a blank name or message, or two built-in copies of one template", async () => {
    const insert = (id: string, name: string, body: string, key: string | null) =>
      h.sql("INSERT INTO email_templates (id,tenant_id,name,builtin_key,html_body,selected,created_at,updated_at) VALUES (?,?,?,?,?,0,1,1)", id, h.tenantId, name, key, body);
    await expect(insert("c1", "  ", BODY, null)).rejects.toThrow();
    await expect(insert("c2", "Fine name", "   ", null)).rejects.toThrow();
    await expect(insert("c3", "x".repeat(101), BODY, null)).rejects.toThrow();
    await expect(insert("c4", "Another construction", BODY, "construction")).rejects.toThrow();
  });
});
