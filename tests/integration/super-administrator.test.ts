import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCESS_LEVELS, SUPER_ADMINISTRATOR } from "../../src/shared/types";
import { hashPassword } from "../../src/server/lib/password";
import { startHarness, type Harness } from "./harness";

let h: Harness;
const EMAIL = "superadmin@sabertoothsoftwarelabs.net";
const PASSWORD = "Password@123";

beforeAll(async () => {
  h = await startHarness();
  // The account the seed script creates: a SuperAdministrator in the reserved platform tenant.
  await h.sql("INSERT INTO tenants (id,name,slug,status,created_at,updated_at) VALUES (?,?,?,?,?,?)", "platform", "Sendrix Platform", "sendrix-platform", "Active", 1, 1);
  await h.sql(
    "INSERT INTO users (id,tenant_id,first_name,last_name,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    "super-1", "platform", "Super", "Administrator", "Super Administrator", EMAIL, EMAIL, await hashPassword(PASSWORD), SUPER_ADMINISTRATOR.id, "Active", 1, 1,
  );
});
afterAll(async () => { await h.dispose(); });

const login = () => h.anonymous.api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
const cookieOf = (r: { headers: Headers }) => /sendrix_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "";

describe("the SuperAdministrator access level", () => {
  it("exists in the access table, with a stable id and name", async () => {
    const rows = await h.rows<{ id: string; name: string }>("SELECT id, name FROM access ORDER BY sort_order");
    expect(rows.map((r) => r.id)).toEqual(["super-administrator", "administrator", "campaign-manager", "viewer"]);
    expect(rows[0]).toEqual({ id: SUPER_ADMINISTRATOR.id, name: "SuperAdministrator" });
  });

  it("is not one a tenant can hand out: it is not in the roles a tenant offers", () => {
    expect(ACCESS_LEVELS.map((a) => a.id)).not.toContain(SUPER_ADMINISTRATOR.id);
  });

  it("cannot be given by an invitation", async () => {
    const r = await h.api("POST", "/api/users/invitations", { email: "sneaky@example.test", firstName: "S", lastName: "N", accessId: SUPER_ADMINISTRATOR.id });
    expect(r.status).toBe(400);
  });
});

describe("the seeded SuperAdministrator", () => {
  it("signs in with the email and password, and is the SuperAdministrator", async () => {
    const r = await login();
    expect(r.status).toBe(200);
    const me = await h.anonymous.api("GET", "/api/me", undefined, { cookie: `sendrix_session=${cookieOf(r)}` });
    expect(me.json).toMatchObject({ user: { email: EMAIL, firstName: "Super", lastName: "Administrator", displayName: "Super Administrator", access: "SuperAdministrator" } });
  });

  it("is not listed among any customer's users", async () => {
    const users = (await h.api("GET", "/api/users")).json.items as { email: string }[];
    expect(users.map((u) => u.email)).not.toContain(EMAIL);
  });

  it("has no access to a tenant's Email Templates, since it manages the shared ones instead", async () => {
    const session = cookieOf(await login());
    const r = await h.anonymous.api("GET", "/api/email-templates", undefined, { cookie: `sendrix_session=${session}` });
    expect(r.status).toBe(403);
  });
});
