import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Caller, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.dispose(); });

const BODY = "<p>Hi {{firstName}}</p>";
const status = async (who: Caller, method: string, path: string, body?: unknown) => (await who.api(method, path, body)).status;

describe("what each kind of account can use", () => {
  // [path, SuperAdmin, JobSeeker, Agency]: true = allowed (anything but 403)
  const matrix: [string, boolean, boolean, boolean][] = [
    ["/api/campaigns", false, false, true],
    ["/api/test-recipients", false, false, true],
    ["/api/suppressions", false, false, true],
    ["/api/jobs/categories", false, true, false],
    ["/api/contacts", false, true, true],
    ["/api/imports", false, true, true],
    ["/api/people/filters", false, true, true],
    ["/api/sender", false, true, true],
    ["/api/users", true, false, false],
    ["/api/global-contacts", true, false, false],
    ["/api/email-templates/available", true, true, true],
    ["/api/email-templates", false, true, true],
    ["/api/me", true, true, true],
  ];
  for (const [path, sa, js, ag] of matrix) {
    it(`${path}: SuperAdmin ${sa ? "yes" : "no"}, JobSeeker ${js ? "yes" : "no"}, Agency ${ag ? "yes" : "no"}`, async () => {
      for (const [who, allowed, name] of [[h.superAdmin, sa, "SuperAdmin"], [h.jobSeeker, js, "JobSeeker"], [h, ag, "Agency"]] as const) {
        const s = await status(who, "GET", path);
        if (allowed) expect(s, `${name} ${path}`).not.toBe(403);
        else expect(s, `${name} ${path}`).toBe(403);
      }
    });
  }

  it("reports the role in /api/me", async () => {
    expect((await h.superAdmin.api("GET", "/api/me")).json.user.role).toBe("SuperAdmin");
    expect((await h.jobSeeker.api("GET", "/api/me")).json.user.role).toBe("JobSeeker");
    expect((await h.api("GET", "/api/me")).json.user.role).toBe("Agency");
  });

  it("a visitor with no session is not signed in", async () => {
    expect(await status(h.anonymous, "GET", "/api/users")).toBe(401);
  });
});

describe("Available Templates", () => {
  it("only a SuperAdmin creates, edits and deletes them", async () => {
    for (const who of [h, h.jobSeeker]) {
      expect(await status(who, "POST", "/api/email-templates/available", { name: "Nope", htmlBody: BODY })).toBe(403);
    }
    const made = await h.superAdmin.api("POST", "/api/email-templates/available", { name: "Aerospace", htmlBody: BODY });
    expect(made.status).toBe(201);
    expect((await h.jobSeeker.api("GET", `/api/email-templates/available/${made.json.id}`)).json.htmlBody).toBe(BODY);
    expect((await h.superAdmin.api("PUT", `/api/email-templates/available/${made.json.id}`, { name: "Aerospace 2", htmlBody: BODY })).json.name).toBe("Aerospace 2");
    expect(await status(h, "DELETE", `/api/email-templates/available/${made.json.id}`)).toBe(403);
    expect(await status(h.superAdmin, "DELETE", `/api/email-templates/available/${made.json.id}`)).toBe(204);
  });

  it("a SuperAdmin has no My Templates, and cannot copy one", async () => {
    expect(await status(h.superAdmin, "POST", "/api/email-templates/available/construction/add")).toBe(403);
    expect(await status(h.superAdmin, "POST", "/api/email-templates", { name: "x", htmlBody: BODY })).toBe(403);
  });
});

describe("User Accounts", () => {
  it("a SuperAdmin adds an account with a role, and it can sign in with that role", async () => {
    const r = await h.superAdmin.api("POST", "/api/users", { email: "new.agency@example.test", firstName: "New", lastName: "Agency", role: "Agency", password: "Password@123" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ email: "new.agency@example.test", role: "Agency", status: "Active", mustChangePassword: true });
    expect(JSON.stringify(r.json)).not.toMatch(/hash|pbkdf2/i);
    const login = await h.anonymous.api("POST", "/api/auth/login", { email: "new.agency@example.test", password: "Password@123" });
    expect(login.status).toBe(200);
  });

  it("lists every account, and refuses a duplicate email or an unknown role", async () => {
    const list = (await h.superAdmin.api("GET", "/api/users")).json.items as { email: string; role: string }[];
    expect(list.map((u) => u.role).sort()).toEqual(expect.arrayContaining(["Agency", "JobSeeker", "SuperAdmin"]));
    expect(await status(h.superAdmin, "POST", "/api/users", { email: "JOBSEEKER@sendrix.app", role: "JobSeeker", password: "Password@123" })).toBe(409);
    expect(await status(h.superAdmin, "POST", "/api/users", { email: "x@example.test", role: "Owner", password: "Password@123" })).toBe(400);
  });

  it("changes a role, and disabling an account ends its sessions", async () => {
    const made = (await h.superAdmin.api("POST", "/api/users", { email: "temp@example.test", role: "JobSeeker", password: "Password@123" })).json;
    const login = await h.anonymous.api("POST", "/api/auth/login", { email: "temp@example.test", password: "Password@123" });
    const cookie = /sendrix_session=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")![1]!;
    const asThem = (p: string) => h.anonymous.api("GET", p, undefined, { cookie: `sendrix_session=${cookie}` });
    expect((await asThem("/api/me")).status).toBe(200);
    expect((await h.superAdmin.api("PATCH", `/api/users/${made.id}`, { role: "Agency" })).json.role).toBe("Agency");
    expect((await asThem("/api/campaigns")).status).toBe(200);
    expect((await h.superAdmin.api("PATCH", `/api/users/${made.id}`, { status: "Disabled" })).json.status).toBe("Disabled");
    expect((await asThem("/api/me")).status).toBe(401);
    expect((await h.anonymous.api("POST", "/api/auth/login", { email: "temp@example.test", password: "Password@123" })).status).toBe(403);
  });

  it("a SuperAdmin cannot lock themselves out", async () => {
    const mine = (await h.superAdmin.api("GET", "/api/me")).json.user.id;
    expect(await status(h.superAdmin, "PATCH", `/api/users/${mine}`, { role: "Agency" })).toBe(409);
    expect(await status(h.superAdmin, "PATCH", `/api/users/${mine}`, { status: "Disabled" })).toBe(409);
    expect(await status(h.superAdmin, "DELETE", `/api/users/${mine}`)).toBe(409);
  });

  it("deletes an account that owns nothing, and refuses one that has data", async () => {
    const empty = (await h.superAdmin.api("POST", "/api/users", { email: "empty@example.test", role: "JobSeeker", password: "Password@123" })).json;
    expect(await status(h.superAdmin, "DELETE", `/api/users/${empty.id}`)).toBe(204);
    const agencyId = (await h.api("GET", "/api/me")).json.user.id;
    await h.api("POST", "/api/contacts", { email: "ann@example.test" });
    expect(await status(h.superAdmin, "DELETE", `/api/users/${agencyId}`)).toBe(409);
    expect(await status(h.superAdmin, "DELETE", "/api/users/nope")).toBe(404);
  });

  it("is not reachable by anyone else", async () => {
    for (const who of [h, h.jobSeeker]) {
      expect(await status(who, "GET", "/api/users")).toBe(403);
      expect(await status(who, "POST", "/api/users", { email: "z@example.test", role: "SuperAdmin", password: "Password@123" })).toBe(403);
      expect(await status(who, "PATCH", "/api/users/anything", { role: "SuperAdmin" })).toBe(403);
    }
  });
});

describe("Global Contacts", () => {
  const person = { firstName: "Ada", lastName: "Lovelace", title: "CTO", company: "Analytical Co", email: "ada@analytical.test", employeeCount: 40, industry: "Software", country: "United Kingdom" };

  it("a SuperAdmin adds, finds, edits and deletes people, and Search People sees them", async () => {
    const made = await h.superAdmin.api("POST", "/api/global-contacts", person);
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ firstName: "Ada", email: "ada@analytical.test", employeeCount: 40 });
    expect((await h.superAdmin.api("GET", "/api/global-contacts?q=lovelace")).json.total).toBe(1);
    expect((await h.superAdmin.api("GET", "/api/global-contacts?q=nobody-here")).json.total).toBe(0);
    // The directory is what everyone searches, though the email stays hidden from them.
    const found = (await h.jobSeeker.api("GET", "/api/people?titles=CTO")).json.items as { id: string; email: string | null }[];
    expect(found.find((p) => p.id === made.json.id)?.email).toBeNull();
    const saved = await h.superAdmin.api("PUT", `/api/global-contacts/${made.json.id}`, { ...person, title: "Chief Engineer" });
    expect(saved.json.title).toBe("Chief Engineer");
    expect(await status(h.superAdmin, "DELETE", `/api/global-contacts/${made.json.id}`)).toBe(204);
    expect(await status(h.superAdmin, "DELETE", `/api/global-contacts/${made.json.id}`)).toBe(404);
  });

  it("refuses a duplicate email (ignoring case), a bad email and unknown fields", async () => {
    await h.superAdmin.api("POST", "/api/global-contacts", { ...person, email: "dup@analytical.test" });
    expect(await status(h.superAdmin, "POST", "/api/global-contacts", { ...person, email: "DUP@analytical.test" })).toBe(409);
    expect(await status(h.superAdmin, "POST", "/api/global-contacts", { ...person, email: "not-an-email" })).toBe(400);
    expect(await status(h.superAdmin, "POST", "/api/global-contacts", { ...person, email: "x@analytical.test", id: "mine" })).toBe(400);
  });

  it("is closed to JobSeeker and Agency, for every method", async () => {
    for (const who of [h, h.jobSeeker]) {
      expect(await status(who, "POST", "/api/global-contacts", person)).toBe(403);
      expect(await status(who, "PUT", "/api/global-contacts/x", person)).toBe(403);
      expect(await status(who, "DELETE", "/api/global-contacts/x")).toBe(403);
    }
  });
});
