import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILTIN_EMAIL_TEMPLATES } from "../../src/shared/builtin-templates";
import { MAX_EMAIL_TEMPLATES } from "../../src/shared/schemas";
import { startHarness, type Caller, type Harness } from "./harness";

let h: Harness;
const GLOBEX = "admin@globex.test";

beforeAll(async () => {
  h = await startHarness();
  await h.addAccount("Globex Corp", GLOBEX);
});
afterAll(async () => { await h.dispose(); });

type Summary = { id: string; name: string; systemKey: string | null; createdAt: string };
const list = async (who: Caller = h) => (await who.api("GET", "/api/email-templates")).json.items as Summary[];
const create = (body: unknown, who: Caller = h) => who.api("POST", "/api/email-templates", body);
const addAvailable = (key: string, who: Caller = h) => who.api("POST", `/api/email-templates/available/${key}/add`);
const remove = (id: string, who: Caller = h) => who.api("DELETE", `/api/email-templates/${id}`);
const BODY = "<p>Hi {{firstName}}, this is for {{companyName}}.</p>";

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

  it("are listed the same for every account, with no body in the list", async () => {
    for (const who of [h, h.as(GLOBEX)]) {
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

  it("are not stored per account: opening them creates nothing in My Templates", async () => {
    const t = await h.addAccount("Quiet Co", "boss@quiet.test");
    await h.as("boss@quiet.test").api("GET", "/api/email-templates/available");
    expect(await list(h.as("boss@quiet.test"))).toEqual([]);
    const rows = await h.rows<{ n: number }>("SELECT count(*) AS n FROM email_templates WHERE user_id = ?", t.userId);
    expect(rows[0]!.n).toBe(0);
  });
});

describe("Available Templates are read-only", () => {
  it("cannot be created, changed or deleted through the API, by anyone", async () => {
    for (const who of [h, h.as(GLOBEX), h.anonymous]) {
      expect((await who.api("POST", "/api/email-templates/available", { name: "Aerospace", htmlBody: BODY })).status).toBeGreaterThanOrEqual(400);
      expect((await who.api("PUT", "/api/email-templates/available/construction", { name: "Hijacked", htmlBody: BODY })).status).toBeGreaterThanOrEqual(400);
      expect((await who.api("DELETE", "/api/email-templates/available/construction")).status).toBeGreaterThanOrEqual(400);
    }
    const after = (await h.api("GET", "/api/email-templates/available/construction")).json;
    expect(after.name).toBe("Construction");
  });
});

describe("editing My Templates", () => {
  const put = (id: string, body: unknown, who: Caller = h) => who.api("PUT", `/api/email-templates/${id}`, body);

  it("changes only the account's copy: the Available Template and other accounts' copies stay as they were", async () => {
    const original = (await h.api("GET", "/api/email-templates/available/construction")).json;
    const mine = (await addAvailable("construction")).json;
    const theirs = (await addAvailable("construction", h.as(GLOBEX))).json;
    const r = await put(mine.id, { name: "Our Construction", htmlBody: "<p>Our own {{firstName}}</p>" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: mine.id, name: "Our Construction", htmlBody: "<p>Our own {{firstName}}</p>", systemKey: "construction" });
    expect((await h.api("GET", "/api/email-templates/available/construction")).json).toEqual(original);
    expect((await h.as(GLOBEX).api("GET", `/api/email-templates/${theirs.id}`)).json).toMatchObject({ name: original.name, htmlBody: original.htmlBody });
    expect((await h.api("GET", `/api/email-templates/${mine.id}`)).json.htmlBody).toBe("<p>Our own {{firstName}}</p>");
    expect((await addAvailable("construction")).json.id).toBe(mine.id); // still counts as added
    // Leave the organizations as they were for the tests that add this template themselves.
    await h.api("DELETE", `/api/email-templates/${mine.id}`);
    await h.as(GLOBEX).api("DELETE", `/api/email-templates/${theirs.id}`);
  });

  it("needs a session, and an account cannot edit another's template", async () => {
    const mine = (await create({ name: "Edit me", htmlBody: BODY })).json;
    expect((await put(mine.id, { name: "X", htmlBody: BODY }, h.as(GLOBEX))).status).toBe(404);
    expect((await h.anonymous.api("PUT", `/api/email-templates/${mine.id}`, { name: "X", htmlBody: BODY })).status).toBe(401);
    expect((await h.api("GET", `/api/email-templates/${mine.id}`)).json.name).toBe("Edit me");
  });

  it("validates like creating: a taken name (ignoring case), a blank name, an unknown merge field, a missing template", async () => {
    await create({ name: "Taken Name", htmlBody: BODY });
    const mine = (await create({ name: "Mine To Edit", htmlBody: BODY })).json;
    expect((await put(mine.id, { name: "taken name", htmlBody: BODY })).status).toBe(409);
    expect((await put(mine.id, { name: "Mine To Edit", htmlBody: "<p>Same name is fine</p>" })).status).toBe(200);
    expect((await put(mine.id, { name: "   ", htmlBody: BODY })).status).toBe(400);
    expect((await put(mine.id, { name: "Ok", htmlBody: "<p>{{frstName}}</p>" })).status).toBe(400);
    expect((await put("nope", { name: "Ok", htmlBody: BODY })).status).toBe(404);
  });
});

describe("who has access", () => {
  it("needs a session", async () => {
    expect((await h.anonymous.api("GET", "/api/email-templates")).status).toBe(401);
    expect((await h.anonymous.api("GET", "/api/email-templates/available")).status).toBe(401);
    expect((await h.anonymous.api("POST", "/api/email-templates/available/construction/add")).status).toBe(401);
  });
});

describe("adding an available template to My Templates", () => {
  it("copies it: the account's own row, tied to the system template, with its exact text", async () => {
    const r = await addAvailable("construction");
    expect(r.status).toBe(201);
    const src = BUILTIN_EMAIL_TEMPLATES.find((t) => t.key === "construction")!;
    expect(r.json).toMatchObject({ name: "Construction", systemKey: "construction", htmlBody: src.htmlBody });
    const listed = (await list()).find((t) => t.systemKey === "construction")!;
    expect(listed.id).toBe(r.json.id);
    expect(Object.keys(listed).sort()).toEqual(["createdAt", "id", "name", "systemKey"]); // no body in the list
    const [row] = await h.rows<{ user_id: string }>("SELECT user_id FROM email_templates WHERE id = ?", r.json.id);
    expect(row!.user_id).toBe(h.userId);
  });

  it("is the same answer when asked twice, and when asked at the same moment: one copy only", async () => {
    const first = await addAvailable("digital-marketing");
    const again = await addAvailable("digital-marketing");
    expect(again.status).toBe(200);
    expect(again.json.id).toBe(first.json.id);
    await Promise.all([1, 2, 3, 4].map(() => addAvailable("healthcare-administration")));
    expect((await list()).filter((t) => t.systemKey === "healthcare-administration")).toHaveLength(1);
  });

  it("is private to the account", async () => {
    await addAvailable("property-management");
    expect((await list(h.as(GLOBEX))).some((t) => t.systemKey === "property-management")).toBe(false);
    expect((await addAvailable("property-management", h.as(GLOBEX))).status).toBe(201);
  });

  it("answers 404 for a template that is not available", async () => {
    expect((await addAvailable("nope")).status).toBe(404);
  });

  it("reports a name clash with one of the account's own templates", async () => {
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
  it("lets an account create one: it is theirs, not from Available, and has the body as written", async () => {
    const r = await create({ name: "  Our own  pitch ", htmlBody: `  ${BODY}  ` });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ name: "Our own pitch", systemKey: null, htmlBody: BODY });
    expect((await list()).find((t) => t.id === r.json.id)).toMatchObject({ name: "Our own pitch", systemKey: null });
    expect((await h.api("GET", `/api/email-templates/${r.json.id}`)).json.htmlBody).toBe(BODY);
    const [row] = await h.rows<{ user_id: string }>("SELECT user_id FROM email_templates WHERE id = ?", r.json.id);
    expect(row).toEqual({ user_id: h.userId });
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

  it("lets two accounts use the same name", async () => {
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
      ["owner smuggled in", { name: "N8", htmlBody: BODY, userId: "other" }],
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
    const t = await h.addAccount("Full Co", "boss@full.test");
    const boss = h.as("boss@full.test");
    for (let i = 0; i < MAX_EMAIL_TEMPLATES; i++) {
      await h.sql("INSERT INTO email_templates (id,user_id,name,html_body,created_at,updated_at) VALUES (?,?,?,?,1,1)", `fill-${i}`, t.userId, `Filler ${i}`, BODY);
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
  it("is private to the account: another account's template is a 404", async () => {
    const theirs = (await create({ name: "Theirs only", htmlBody: BODY }, h.as(GLOBEX))).json;
    expect((await h.api("GET", `/api/email-templates/${theirs.id}`)).status).toBe(404);
    expect((await h.api("GET", "/api/email-templates/does-not-exist")).status).toBe(404);
    expect((await list()).some((t) => t.id === theirs.id)).toBe(false);
  });

  it("lists them by name", async () => {
    const t = await h.addAccount("Sorted Co", "boss@sorted.test");
    const boss = h.as("boss@sorted.test");
    for (const name of ["Zulu", "Alpha", "Mike"]) await create({ name, htmlBody: BODY }, boss);
    expect((await list(boss)).map((x) => x.name)).toEqual(["Alpha", "Mike", "Zulu"]);
    expect(t.userId).toBeTruthy();
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

  it("cannot touch another account's template, or one that does not exist", async () => {
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
      h.sql("INSERT INTO email_templates (id,user_id,name,builtin_key,html_body,created_at,updated_at) VALUES (?,?,?,?,?,1,1)", id, h.userId, name, key, body);
    await expect(insert("c1", "  ", BODY, null)).rejects.toThrow();
    await expect(insert("c2", "Fine name", "   ", null)).rejects.toThrow();
    await expect(insert("c3", "x".repeat(101), BODY, null)).rejects.toThrow();
    const copied = (await addAvailable("construction")).json;
    expect(copied.id).toBeTruthy();
    await expect(insert("c4", "Another construction", BODY, "construction")).rejects.toThrow();
  });
});
