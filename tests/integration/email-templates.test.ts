import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILTIN_EMAIL_TEMPLATES } from "../../src/shared/builtin-templates";
import { MAX_EMAIL_TEMPLATES } from "../../src/shared/schemas";
import { hashPassword } from "../../src/server/lib/password";
import { startHarness, uniqueEmail, type Caller, type Harness } from "./harness";

let h: Harness;
const GLOBEX = "admin@globex.test";
const SUPER = "superadmin@sabertoothsoftwarelabs.net";

beforeAll(async () => {
  h = await startHarness();
  await h.addTenant("Globex Corp", GLOBEX);
  // The SuperAdministrator, as the seed script makes it: a global user held in the reserved platform tenant.
  await h.sql("INSERT INTO tenants (id,name,slug,status,created_at,updated_at) VALUES (?,?,?,?,?,?)", "platform", "Sendrix Platform", "sendrix-platform", "Active", 1, 1);
  await h.sql(
    "INSERT INTO users (id,tenant_id,first_name,last_name,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    "super-1", "platform", "Super", "Administrator", "Super Administrator", SUPER, SUPER, await hashPassword("Password@123"), "super-administrator", "Active", 1, 1,
  );
});
afterAll(async () => { await h.dispose(); });

type Summary = { id: string; name: string; systemKey: string | null; createdAt: string };
const list = async (who: Caller = h) => (await who.api("GET", "/api/email-templates")).json.items as Summary[];
const create = (body: unknown, who: Caller = h) => who.api("POST", "/api/email-templates", body);
const addAvailable = (key: string, who: Caller = h) => who.api("POST", `/api/email-templates/available/${key}/add`);
const remove = (id: string, who: Caller = h) => who.api("DELETE", `/api/email-templates/${id}`);
const BODY = "<p>Hi {{firstName}}, this is for {{companyName}}.</p>";

async function member(accessId: string) {
  const email = uniqueEmail(accessId);
  await h.sql("INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", `u-${email}`, h.tenantId, "M", email, email, "x", accessId, "Active", 1, 1);
  return h.as(email);
}

describe("Available Templates (made by the system)", () => {
  it("are the nine from the Email Templates folder", () => {
    expect(BUILTIN_EMAIL_TEMPLATES.map((t) => t.name)).toEqual([
      "Automotive Services", "Construction", "Digital Marketing", "Food & Beverage Manufacturing", "Healthcare Administration",
      "Professional Services", "Property Management", "Transportation & Logistics", "Wholesale & Distribution",
    ]);
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

  it("are listed for Administrators and Campaign Managers, the same for every organization, with no body in the list", async () => {
    for (const who of [h, await member("campaign-manager"), h.as(GLOBEX)]) {
      const r = await who.api("GET", "/api/email-templates/available");
      expect(r.status).toBe(200);
      expect(r.json.items.map((t: { id: string; name: string }) => [t.id, t.name]).sort()).toEqual(BUILTIN_EMAIL_TEMPLATES.map((t) => [t.key, t.name]).sort());
      expect(Object.keys(r.json.items[0]).sort()).toEqual(["createdAt", "id", "name", "updatedAt"]); // no body in the list
    }
  });

  it("can be read one at a time, with the exact text of the files", async () => {
    for (const t of BUILTIN_EMAIL_TEMPLATES) {
      const r = await h.api("GET", `/api/email-templates/available/${t.key}`);
      expect(r.json).toMatchObject({ id: t.key, name: t.name, htmlBody: t.htmlBody });
    }
    expect((await h.api("GET", "/api/email-templates/available/nope")).status).toBe(404);
  });

  it("are not stored per organization: opening them creates nothing in My Templates", async () => {
    const t = await h.addTenant("Quiet Co", "boss@quiet.test");
    await h.as("boss@quiet.test").api("GET", "/api/email-templates/available");
    expect(await list(h.as("boss@quiet.test"))).toEqual([]);
    const rows = await h.rows<{ n: number }>("SELECT count(*) AS n FROM email_templates WHERE tenant_id = ?", t.tenantId);
    expect(rows[0]!.n).toBe(0);
  });
});

describe("a SuperAdministrator managing the Available Templates", () => {
  const sa = () => h.as(SUPER);
  const mk = (name: string, who: Caller = sa()) => who.api("POST", "/api/email-templates/available", { name, htmlBody: BODY });

  it("is the only role that can create one: it is listed for everyone and readable with its body", async () => {
    const r = await mk("Aerospace");
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ name: "Aerospace", htmlBody: BODY });
    const [row] = await h.rows<{ created_by: string }>("SELECT created_by FROM system_templates WHERE id = ?", r.json.id);
    expect(row!.created_by).toBe("super-1");
    for (const who of [h, await member("campaign-manager"), h.as(GLOBEX)]) {
      expect((await who.api("GET", "/api/email-templates/available")).json.items.some((t: { name: string }) => t.name === "Aerospace")).toBe(true);
      expect((await who.api("GET", `/api/email-templates/available/${r.json.id}`)).json.htmlBody).toBe(BODY);
    }
  });

  it("is refused to everyone else: Administrators, Campaign Managers and Viewers cannot create, change or delete", async () => {
    const made = (await mk("Protected")).json;
    for (const [level, who] of [["administrator", h], ["campaign-manager", await member("campaign-manager")], ["viewer", await member("viewer")]] as const) {
      expect((await mk(`By ${level}`, who)).status, level).toBe(403);
      expect((await who.api("PUT", `/api/email-templates/available/${made.id}`, { name: "Hijacked", htmlBody: BODY })).status, level).toBe(403);
      expect((await who.api("DELETE", `/api/email-templates/available/${made.id}`)).status, level).toBe(403);
    }
    const after = (await h.api("GET", `/api/email-templates/available/${made.id}`)).json;
    expect(after.name).toBe("Protected");
    expect((await h.anonymous.api("POST", "/api/email-templates/available", { name: "x", htmlBody: BODY })).status).toBe(401);
  });

  it("can edit one: the name and message change for everyone, and organizations' existing copies do not", async () => {
    const made = (await mk("Before")).json;
    const copy = (await addAvailable(made.id)).json;
    const r = await sa().api("PUT", `/api/email-templates/available/${made.id}`, { name: "After", htmlBody: "<p>New {{firstName}}</p>" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: made.id, name: "After", htmlBody: "<p>New {{firstName}}</p>" });
    expect((await h.api("GET", `/api/email-templates/available/${made.id}`)).json.name).toBe("After");
    expect((await h.api("GET", `/api/email-templates/${copy.id}`)).json).toMatchObject({ name: "Before", htmlBody: BODY }); // the copy is independent
  });

  it("can delete one: it is gone for everyone, and organizations' copies stay", async () => {
    const made = (await mk("Doomed")).json;
    const copy = (await addAvailable(made.id)).json;
    expect((await sa().api("DELETE", `/api/email-templates/available/${made.id}`)).status).toBe(204);
    expect((await h.api("GET", `/api/email-templates/available/${made.id}`)).status).toBe(404);
    expect((await addAvailable(made.id)).status).toBe(404);
    expect((await h.api("GET", `/api/email-templates/${copy.id}`)).status).toBe(200);
    expect((await sa().api("DELETE", `/api/email-templates/available/${made.id}`)).status).toBe(404);
  });

  it("can change one of the nine that came with the app", async () => {
    const original = BUILTIN_EMAIL_TEMPLATES.find((t) => t.key === "transportation-logistics")!;
    const r = await sa().api("PUT", "/api/email-templates/available/transportation-logistics", { name: "Transport & Logistics", htmlBody: BODY });
    expect(r.status).toBe(200);
    expect((await h.api("GET", "/api/email-templates/available")).json.items.map((t: { name: string }) => t.name)).toContain("Transport & Logistics");
    await sa().api("PUT", "/api/email-templates/available/transportation-logistics", { name: original.name, htmlBody: original.htmlBody });
  });

  it("validates like My Templates: a name that is taken (ignoring case), a blank or long one, a missing message, an unknown merge field", async () => {
    await mk("Unique One");
    expect((await mk("unique one")).status).toBe(409);
    expect((await mk("Construction")).json.error.code).toBe("TEMPLATE_NAME_TAKEN"); // one of the nine
    const other = (await mk("Unique Two")).json;
    const clash = await sa().api("PUT", `/api/email-templates/available/${other.id}`, { name: "UNIQUE ONE", htmlBody: BODY });
    expect(clash.status).toBe(409);
    expect((await sa().api("PUT", `/api/email-templates/available/${other.id}`, { name: "Unique Two", htmlBody: BODY })).status).toBe(200); // keeping its own name is fine
    for (const body of [{ name: "", htmlBody: BODY }, { name: "   ", htmlBody: BODY }, { name: "x".repeat(101), htmlBody: BODY }, { name: "N1" }, { name: "N2", htmlBody: "<p>&nbsp;</p>" }, { name: "N3", htmlBody: BODY, key: "x" }]) {
      expect((await sa().api("POST", "/api/email-templates/available", body)).status, JSON.stringify(body)).toBe(400);
    }
    const typo = await sa().api("POST", "/api/email-templates/available", { name: "Typo 2", htmlBody: "<p>{{frstName}}</p>" });
    expect(typo.status).toBe(400);
    expect(typo.json.error.details).toEqual([{ path: "htmlBody", message: "Unknown merge field: {{frstName}}" }]);
    expect((await sa().api("PUT", "/api/email-templates/available/nope", { name: "Whatever", htmlBody: BODY })).status).toBe(404);
  });

  it("has no My Templates: every route of an organization's own list answers 403", async () => {
    const mine = (await create({ name: "Org only", htmlBody: BODY })).json;
    for (const [method, path] of [["GET", "/api/email-templates"], ["GET", `/api/email-templates/${mine.id}`], ["POST", "/api/email-templates/available/construction/add"], ["DELETE", `/api/email-templates/${mine.id}`]] as const) {
      expect((await sa().api(method, path)).status, `${method} ${path}`).toBe(403);
    }
    expect((await create({ name: "By super", htmlBody: BODY }, sa())).status).toBe(403);
  });

  it("refuses a cross-site request", async () => {
    expect((await sa().api("POST", "/api/email-templates/available", { name: "Evil", htmlBody: BODY }, { origin: "https://evil.test" })).status).toBe(403);
  });
});

describe("who has access", () => {
  it("gives a Viewer no access at all: the lists, one template, adding and removing all answer 403", async () => {
    const viewer = await member("viewer");
    const mine = (await create({ name: "Visible to staff", htmlBody: BODY })).json;
    for (const [method, path] of [
      ["GET", "/api/email-templates"], ["GET", `/api/email-templates/${mine.id}`], ["GET", "/api/email-templates/available"],
      ["GET", "/api/email-templates/available/construction"], ["POST", "/api/email-templates/available/construction/add"], ["DELETE", `/api/email-templates/${mine.id}`],
    ] as const) {
      expect((await viewer.api(method, path)).status, `${method} ${path}`).toBe(403);
    }
    expect((await create({ name: "By viewer", htmlBody: BODY }, viewer)).status).toBe(403);
    expect((await list()).some((t) => t.id === mine.id)).toBe(true); // still there
  });

  it("gives a Campaign Manager read access only", async () => {
    const cm = await member("campaign-manager");
    const mine = (await create({ name: "CM can read this", htmlBody: BODY })).json;
    expect((await cm.api("GET", "/api/email-templates")).status).toBe(200);
    expect((await cm.api("GET", `/api/email-templates/${mine.id}`)).json.htmlBody).toBe(BODY);
    expect((await cm.api("GET", "/api/email-templates/available/construction")).status).toBe(200);
    expect((await create({ name: "By CM", htmlBody: BODY }, cm)).status).toBe(403);
    expect((await addAvailable("construction", cm)).status).toBe(403);
    expect((await remove(mine.id, cm)).status).toBe(403);
    expect((await list()).some((t) => t.name === "By CM")).toBe(false);
    expect((await list()).some((t) => t.id === mine.id)).toBe(true);
  });

  it("needs a session", async () => {
    expect((await h.anonymous.api("GET", "/api/email-templates")).status).toBe(401);
    expect((await h.anonymous.api("GET", "/api/email-templates/available")).status).toBe(401);
    expect((await h.anonymous.api("POST", "/api/email-templates/available/construction/add")).status).toBe(401);
  });
});

describe("adding an available template to My Templates", () => {
  it("copies it: the organization's own row, tied to the system template, with its exact text", async () => {
    const r = await addAvailable("construction");
    expect(r.status).toBe(201);
    const src = BUILTIN_EMAIL_TEMPLATES.find((t) => t.key === "construction")!;
    expect(r.json).toMatchObject({ name: "Construction", systemKey: "construction", htmlBody: src.htmlBody });
    const listed = (await list()).find((t) => t.systemKey === "construction")!;
    expect(listed.id).toBe(r.json.id);
    expect(Object.keys(listed).sort()).toEqual(["createdAt", "id", "name", "systemKey"]); // no body in the list
    const [row] = await h.rows<{ created_by: string }>("SELECT created_by FROM email_templates WHERE id = ?", r.json.id);
    expect(row!.created_by).toBe(h.userId);
  });

  it("is the same answer when asked twice, and when asked at the same moment: one copy only", async () => {
    const first = await addAvailable("digital-marketing");
    const again = await addAvailable("digital-marketing");
    expect(again.status).toBe(200);
    expect(again.json.id).toBe(first.json.id);
    await Promise.all([1, 2, 3, 4].map(() => addAvailable("healthcare-administration")));
    expect((await list()).filter((t) => t.systemKey === "healthcare-administration")).toHaveLength(1);
  });

  it("is private to the organization", async () => {
    await addAvailable("property-management");
    expect((await list(h.as(GLOBEX))).some((t) => t.systemKey === "property-management")).toBe(false);
    expect((await addAvailable("property-management", h.as(GLOBEX))).status).toBe(201);
  });

  it("answers 404 for a template that is not available", async () => {
    expect((await addAvailable("nope")).status).toBe(404);
  });

  it("reports a name clash with one of the organization's own templates", async () => {
    await create({ name: "Wholesale & Distribution", htmlBody: BODY });
    const r = await addAvailable("wholesale-distribution");
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("TEMPLATE_NAME_TAKEN");
  });

  it("refuses a cross-site request", async () => {
    expect((await h.api("POST", "/api/email-templates/available/transportation-logistics/add", undefined, { origin: "https://evil.test" })).status).toBe(403);
    expect((await list()).some((t) => t.systemKey === "transportation-logistics")).toBe(false);
  });
});

describe("creating a template", () => {
  it("lets an Administrator create one: it is theirs, not from Available, and has the body as written", async () => {
    const r = await create({ name: "  Our own  pitch ", htmlBody: `  ${BODY}  ` });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ name: "Our own pitch", systemKey: null, htmlBody: BODY });
    expect((await list()).find((t) => t.id === r.json.id)).toMatchObject({ name: "Our own pitch", systemKey: null });
    expect((await h.api("GET", `/api/email-templates/${r.json.id}`)).json.htmlBody).toBe(BODY);
    const [row] = await h.rows<{ created_by: string; builtin_key: string | null }>("SELECT created_by, builtin_key FROM email_templates WHERE id = ?", r.json.id);
    expect(row).toEqual({ created_by: h.userId, builtin_key: null });
  });

  it("refuses a name that is already used, ignoring letter case, and names the field", async () => {
    await create({ name: "Taken Name", htmlBody: BODY });
    for (const name of ["taken name", "TAKEN NAME"]) {
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
      ["huge message", { name: "N5", htmlBody: "x".repeat(200_001) }],
      ["name not text", { name: 5, htmlBody: BODY }],
      ["extra field", { name: "N7", htmlBody: BODY, systemKey: "construction" }],
      ["tenant smuggled in", { name: "N8", htmlBody: BODY, tenantId: "other" }],
    ];
    for (const [what, body] of bad) expect((await create(body)).status, what).toBe(400);
    expect((await h.api("POST", "/api/email-templates", "{nope")).status).toBe(400);
    expect((await list()).some((t) => /^N\d$/.test(t.name))).toBe(false);
  });

  it("refuses a merge field that does not exist, and says which", async () => {
    const r = await create({ name: "Typo", htmlBody: "<p>Hi {{frstName}} and {{companyNmae}}</p>" });
    expect(r.status).toBe(400);
    expect(r.json.error.details).toEqual([{ path: "htmlBody", message: "Unknown merge fields: {{frstName}}, {{companyNmae}}" }]);
    expect((await create({ name: "Fine", htmlBody: "<p>{{firstName}} {{lastName}} {{title}} {{unsubscribeUrl}}</p>" })).status).toBe(201);
  });

  it("is limited in size, for creating and for adding, and says so", async () => {
    const t = await h.addTenant("Full Co", "boss@full.test");
    const boss = h.as("boss@full.test");
    for (let i = 0; i < MAX_EMAIL_TEMPLATES; i++) {
      await h.sql("INSERT INTO email_templates (id,tenant_id,name,html_body,created_at,updated_at) VALUES (?,?,?,?,1,1)", `fill-${i}`, t.tenantId, `Filler ${i}`, BODY);
    }
    const made = await create({ name: "One too many", htmlBody: BODY }, boss);
    expect(made.status).toBe(409);
    expect(made.json.error.code).toBe("TOO_MANY_TEMPLATES");
    expect((await addAvailable("construction", boss)).json.error.code).toBe("TOO_MANY_TEMPLATES");
  });

  it("refuses a cross-site request", async () => {
    expect((await h.api("POST", "/api/email-templates", { name: "Evil", htmlBody: BODY }, { origin: "https://evil.test" })).status).toBe(403);
    expect((await list()).some((t) => t.name === "Evil")).toBe(false);
  });
});

describe("reading My Templates", () => {
  it("is private to the organization: another organization's template is a 404", async () => {
    const theirs = (await create({ name: "Theirs only", htmlBody: BODY }, h.as(GLOBEX))).json;
    expect((await h.api("GET", `/api/email-templates/${theirs.id}`)).status).toBe(404);
    expect((await h.api("GET", "/api/email-templates/does-not-exist")).status).toBe(404);
    expect((await list()).some((t) => t.id === theirs.id)).toBe(false);
  });

  it("lists them by name", async () => {
    const t = await h.addTenant("Sorted Co", "boss@sorted.test");
    const boss = h.as("boss@sorted.test");
    for (const name of ["Zulu", "Alpha", "Mike"]) await create({ name, htmlBody: BODY }, boss);
    expect((await list(boss)).map((x) => x.name)).toEqual(["Alpha", "Mike", "Zulu"]);
    expect(t.tenantId).toBeTruthy();
  });
});

describe("removing a template from My Templates", () => {
  it("deletes it for good, whether it was copied from Available or created", async () => {
    const copied = (await addAvailable("professional-services")).json;
    const own = (await create({ name: "Remove me", htmlBody: BODY })).json;
    for (const id of [copied.id, own.id]) {
      expect((await remove(id)).status).toBe(204);
      expect((await h.api("GET", `/api/email-templates/${id}`)).status).toBe(404);
      expect((await list()).some((t) => t.id === id)).toBe(false);
    }
  });

  it("brings an available template back to be added again after it was removed", async () => {
    const first = (await addAvailable("automotive-services")).json;
    await remove(first.id);
    const second = await addAvailable("automotive-services");
    expect(second.status).toBe(201);
    expect(second.json.id).not.toBe(first.id);
  });

  it("changes nothing in Available Templates", async () => {
    const before = (await h.api("GET", "/api/email-templates/available")).json.items;
    const copied = (await addAvailable("food-beverage-manufacturing")).json;
    await remove(copied.id);
    expect((await h.api("GET", "/api/email-templates/available")).json.items).toEqual(before);
  });

  it("cannot touch another organization's template, or one that does not exist", async () => {
    const theirs = (await create({ name: "Keep me", htmlBody: BODY }, h.as(GLOBEX))).json;
    expect((await remove(theirs.id)).status).toBe(404);
    expect((await list(h.as(GLOBEX))).some((t) => t.id === theirs.id)).toBe(true);
    expect((await remove("does-not-exist")).status).toBe(404);
  });

  it("refuses a cross-site request", async () => {
    const own = (await create({ name: "Cross site", htmlBody: BODY })).json;
    expect((await h.api("DELETE", `/api/email-templates/${own.id}`, undefined, { origin: "https://evil.test" })).status).toBe(403);
    expect((await list()).some((t) => t.id === own.id)).toBe(true);
  });
});

describe("what the table allows", () => {
  it("cannot hold a blank name or message, or two copies of one system template", async () => {
    const insert = (id: string, name: string, body: string, key: string | null) =>
      h.sql("INSERT INTO email_templates (id,tenant_id,name,builtin_key,html_body,created_at,updated_at) VALUES (?,?,?,?,?,1,1)", id, h.tenantId, name, key, body);
    await expect(insert("c1", "  ", BODY, null)).rejects.toThrow();
    await expect(insert("c2", "Fine name", "   ", null)).rejects.toThrow();
    await expect(insert("c3", "x".repeat(101), BODY, null)).rejects.toThrow();
    const copied = (await addAvailable("construction")).json;
    expect(copied.id).toBeTruthy();
    await expect(insert("c4", "Another construction", BODY, "construction")).rejects.toThrow();
  });
});
