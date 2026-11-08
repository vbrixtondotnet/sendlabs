import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, uniqueEmail, type Harness } from "./harness";

let h: Harness;
let other: { tenantId: string; userId: string };
const otherEmail = "admin@globex.test";

beforeAll(async () => {
  h = await startHarness();
  other = await h.addTenant("Globex Corp", otherEmail);
});
afterAll(async () => { await h.dispose(); });

/** Adds a user straight into a tenant. The invite flow that will create users normally is not built yet. */
const addUser = async (tenantId: string, email: string, accessId: string, createdAt: number, status = "Active", lastLoginAt: number | null = null) => {
  await h.sql(
    "INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,last_login_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    `u-${email}`, tenantId, email.split("@")[0], email, email.toLowerCase(), "pbkdf2-sha256$1$AA$AA", accessId, status, lastLoginAt, createdAt, createdAt,
  );
};

describe("GET /api/users", () => {
  it("lists the tenant's users with their access level, and nothing else about them", async () => {
    const r = await h.api("GET", "/api/users");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ page: 1, pageSize: 25 });
    const admin = r.json.items.find((u: { email: string }) => u.email === h.adminEmail);
    expect(admin).toMatchObject({
      id: h.userId, displayName: "Administrator", access: "Administrator", accessId: "administrator",
      status: "Active", mustChangePassword: false, lastLoginAt: null,
    });
    expect(new Date(admin.createdAt).toISOString()).toBe(admin.createdAt);
    expect(Object.keys(admin).sort()).toEqual(["access", "accessId", "createdAt", "displayName", "email", "firstName", "id", "lastLoginAt", "lastName", "mustChangePassword", "status"]);
  });

  it("never contains any password data", async () => {
    const text = JSON.stringify((await h.api("GET", "/api/users")).json);
    expect(text).not.toMatch(/pbkdf2|passwordHash|password_hash|\$[A-Za-z0-9+/=]{20,}/);
  });

  it("shows only the caller's own tenant, whoever asks", async () => {
    await addUser(h.tenantId, "mine@a.test", "viewer", 5_000);
    await addUser(other.tenantId, "theirs@b.test", "viewer", 5_000);
    const mine = (await h.api("GET", "/api/users?pageSize=100")).json.items.map((u: { email: string }) => u.email);
    const theirs = (await h.as(otherEmail).api("GET", "/api/users?pageSize=100")).json.items.map((u: { email: string }) => u.email);
    expect(mine).toContain("mine@a.test");
    expect(mine).not.toContain("theirs@b.test");
    expect(mine).not.toContain(otherEmail);
    expect(theirs).toContain("theirs@b.test");
    expect(theirs).not.toContain("mine@a.test");
    expect(theirs).not.toContain(h.adminEmail);
    // the totals count only their own users too
    const dbA = (await h.rows<{ n: number }>("SELECT count(*) AS n FROM users WHERE tenant_id = ?", h.tenantId))[0]!.n;
    expect((await h.api("GET", "/api/users")).json.total).toBe(dbA);
  });

  it("orders Administrators first, then Campaign Managers, then Viewers, oldest first within each", async () => {
    const { tenantId } = await h.addTenant("Ordering Inc", "boss@ordering.test");
    await addUser(tenantId, "v-old@ordering.test", "viewer", 1_000);
    await addUser(tenantId, "m-new@ordering.test", "campaign-manager", 4_000);
    await addUser(tenantId, "a-second@ordering.test", "administrator", 3_000);
    await addUser(tenantId, "m-old@ordering.test", "campaign-manager", 2_000);
    const r = await h.as("boss@ordering.test").api("GET", "/api/users");
    const order = r.json.items.map((u: { email: string }) => u.email);
    // the first admin was created "now", so the 1970-era test users come before it within their own level
    expect(order).toEqual(["a-second@ordering.test", "boss@ordering.test", "m-old@ordering.test", "m-new@ordering.test", "v-old@ordering.test"]);
    expect(r.json.items.map((u: { access: string }) => u.access)).toEqual(["Administrator", "Administrator", "Campaign Manager", "Campaign Manager", "Viewer"]);
  });

  it("paginates", async () => {
    const { tenantId } = await h.addTenant("Paging Ltd", "boss@paging.test");
    for (let i = 0; i < 4; i++) await addUser(tenantId, `v${i}@paging.test`, "viewer", 1_000 + i);
    const caller = h.as("boss@paging.test");
    const p1 = (await caller.api("GET", "/api/users?pageSize=2&page=1")).json;
    const p3 = (await caller.api("GET", "/api/users?pageSize=2&page=3")).json;
    expect(p1).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p3.items).toHaveLength(1);
    expect((await caller.api("GET", "/api/users?pageSize=101")).status).toBe(400);
    expect((await caller.api("GET", "/api/users?page=0")).status).toBe(400);
  });

  it("reports a last sign-in once there is one, and the disabled state", async () => {
    const { tenantId } = await h.addTenant("Signin Co", "boss@signin.test");
    await addUser(tenantId, "gone@signin.test", "viewer", 1_000, "Disabled", 1_700_000_000_000);
    const gone = (await h.as("boss@signin.test").api("GET", "/api/users")).json.items.find((u: { email: string }) => u.email === "gone@signin.test");
    expect(gone).toMatchObject({ status: "Disabled", lastLoginAt: "2023-11-14T22:13:20.000Z" });
  });
});

describe("who may see users", () => {
  it("is for Administrators only: Campaign Managers and Viewers are refused", async () => {
    const { tenantId } = await h.addTenant("Roles Co", "boss@roles.test");
    await addUser(tenantId, "mgr@roles.test", "campaign-manager", 1_000);
    await addUser(tenantId, "view@roles.test", "viewer", 1_000);
    expect((await h.as("boss@roles.test").api("GET", "/api/users")).status).toBe(200);
    for (const email of ["mgr@roles.test", "view@roles.test"]) {
      const r = await h.as(email).api("GET", "/api/users");
      expect(r.status, email).toBe(403);
      expect(r.json.error.code).toBe("FORBIDDEN");
    }
  });

  it("does not let the Administrator guard leak into the rest of the API (other routes are unchanged)", async () => {
    const { tenantId } = await h.addTenant("Scope Co", "boss@scope.test");
    await addUser(tenantId, "view@scope.test", "viewer", 1_000);
    expect((await h.as("view@scope.test").api("GET", "/api/contacts")).status).toBe(200);
    expect((await h.as("view@scope.test").api("GET", "/api/me")).json.user.access).toBe("Viewer");
  });

  it("refuses unknown and disabled users, and fails closed outside local", async () => {
    expect((await h.as(uniqueEmail("ghost")).api("GET", "/api/users")).status).toBe(401);
    const { tenantId } = await h.addTenant("Off Co", "boss@off.test");
    await h.sql("UPDATE users SET status='Disabled' WHERE tenant_id = ?", tenantId);
    expect((await h.as("boss@off.test").api("GET", "/api/users")).json.error.code).toBe("USER_DISABLED");
    const prod = await h.withEnv({ ENVIRONMENT: "production" }).api("GET", "/api/users");
    expect(prod.status).toBe(503);
  });
});

describe("what is deliberately not built yet", () => {
  it("has no way to create users directly or change their access (only invitations add users, and removing is separate)", async () => {
    const attempts: [string, string, unknown?][] = [
      ["POST", "/api/users", { email: "new@a.test", access: "Viewer" }],
      ["POST", "/api/users/invite", { email: "new@a.test" }],
      ["POST", "/api/invitations", { email: "new@a.test" }],
      ["PATCH", `/api/users/${h.userId}`, { accessId: "viewer" }],
    ];
    for (const [method, path, body] of attempts) {
      const r = await h.api(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    expect((await h.rows("SELECT id FROM users WHERE normalized_email = 'new@a.test'"))).toEqual([]);
    expect((await h.api("GET", "/api/users")).json.items.find((u: { id: string }) => u.id === h.userId).access).toBe("Administrator");
  });
});
