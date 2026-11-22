import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPassword } from "../../src/server/lib/password";
import { provisionTenant } from "../../src/server/services/tenants";
import { ACCESS_LEVELS, SUPER_ADMINISTRATOR } from "../../src/shared/types";
import { startHarness, uniqueEmail, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.dispose(); });

const now = Date.now();
const rejected = (statement: string, ...params: unknown[]) => expect(h.sql(statement, ...params)).rejects.toThrow(/constraint|FOREIGN KEY/i);
const insertTenant = (id: string, name: string, slug: string, status = "Active") =>
  h.sql("INSERT INTO tenants (id,name,slug,status,created_at,updated_at) VALUES (?,?,?,?,?,?)", id, name, slug, status, now, now);
const insertUser = (id: string, tenantId: string, email: string, accessId = "viewer", status = "Active", hash = "pbkdf2-sha256$1$AA$AA") =>
  h.sql("INSERT INTO users (id,tenant_id,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    id, tenantId, email, email.trim().toLowerCase(), hash, accessId, status, now, now);

describe("access (the roles)", () => {
  it("holds the SuperAdministrator plus Administrator, Campaign Manager and Viewer, matching the shared catalog", async () => {
    const rows = await h.rows<{ id: string; name: string; description: string; sort_order: number }>("SELECT id,name,description,sort_order FROM access ORDER BY sort_order");
    expect(rows).toEqual([SUPER_ADMINISTRATOR, ...ACCESS_LEVELS].map((a) => ({ id: a.id, name: a.name, description: a.description, sort_order: a.sortOrder })));
    expect(rows.map((r) => r.name)).toEqual(["SuperAdministrator", "Administrator", "Campaign Manager", "Viewer"]);
  });
  it("does not allow two levels with the same name", async () => {
    await rejected("INSERT INTO access (id,name,description,sort_order,created_at) VALUES (?,?,?,?,?)", "admin-2", "Administrator", "dup", 9, now);
  });
});

describe("tenants table", () => {
  it("requires unique identifiers and names (names ignore letter case)", async () => {
    await insertTenant("t-acme", "Acme Industries", "acme");
    await rejected("INSERT INTO tenants (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)", "t-dup1", "Other Name", "acme", now, now);
    await rejected("INSERT INTO tenants (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)", "t-dup2", "ACME INDUSTRIES", "acme-two", now, now);
  });
  it("enforces a URL-safe slug, a real name and a known status", async () => {
    for (const slug of ["Has Space", "UPPER", "under_score", "dots.in.it", "", "ünï"]) {
      await rejected("INSERT INTO tenants (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)", `t-${slug}`, `Name ${slug}`, slug, now, now);
    }
    await rejected("INSERT INTO tenants (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)", "t-blank", "   ", "blank", now, now);
    await rejected("INSERT INTO tenants (id,name,slug,status,created_at,updated_at) VALUES (?,?,?,?,?,?)", "t-st", "Status", "status", "Deleted", now, now);
  });
});

describe("users table", () => {
  it("makes the email unique across ALL tenants, ignoring case", async () => {
    await insertTenant("t-u1", "User Co One", "user-co-one");
    await insertTenant("t-u2", "User Co Two", "user-co-two");
    await insertUser("u-1", "t-u1", "pat@example.test");
    await expect(insertUser("u-2", "t-u2", "pat@example.test")).rejects.toThrow(/UNIQUE|constraint/i);
    await expect(insertUser("u-3", "t-u1", "PAT@Example.Test")).rejects.toThrow(/UNIQUE|constraint/i);
  });
  it("requires a real tenant, a known access level and a known status", async () => {
    await expect(insertUser("u-x1", "no-such-tenant", uniqueEmail())).rejects.toThrow(/FOREIGN KEY|constraint/i);
    await expect(insertUser("u-x2", "t-u1", uniqueEmail(), "superuser")).rejects.toThrow(/FOREIGN KEY|constraint/i);
    await expect(insertUser("u-x3", "t-u1", uniqueEmail(), "viewer", "Banned")).rejects.toThrow(/constraint/i);
  });
  it("requires a password hash and a normalized email", async () => {
    await expect(insertUser("u-x4", "t-u1", uniqueEmail(), "viewer", "Active", "")).rejects.toThrow(/constraint/i);
    await rejected("INSERT INTO users (id,tenant_id,email,normalized_email,password_hash,access_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      "u-x5", "t-u1", "Mixed@Case.test", "Mixed@Case.test", "h", "viewer", now, now);
  });
  it("accepts all three access levels", async () => {
    for (const a of ACCESS_LEVELS) await insertUser(`u-ok-${a.id}`, "t-u1", uniqueEmail(a.id), a.id);
    const n = await h.rows<{ n: number }>("SELECT count(DISTINCT access_id) AS n FROM users WHERE id LIKE 'u-ok-%'");
    expect(n[0]!.n).toBe(3);
  });
  it("will not delete an access level that users hold", async () => {
    await rejected("DELETE FROM access WHERE id = ?", "viewer");
  });
});

describe("provisioning a tenant with its first administrator", () => {
  const db = () => h.db;
  const input = (name: string, email: string, password = "Sup3r-Secret!") => ({ name, admin: { email, displayName: "Ada", password } });

  it("creates the tenant and an Administrator whose password is stored hashed", async () => {
    const email = uniqueEmail("ada");
    const r = await provisionTenant(db(), { ...input("Initech LLC", email), admin: { email, password: "Sup3r-Secret!", mustChangePassword: true } });
    expect(r.slug).toBe("initech-llc");
    const [u] = await h.rows<{ password_hash: string; access_id: string; must_change_password: number; tenant_id: string; status: string }>(
      "SELECT password_hash,access_id,must_change_password,tenant_id,status FROM users WHERE id = ?", r.userId);
    expect(u).toMatchObject({ access_id: "administrator", must_change_password: true, tenant_id: r.tenantId, status: "Active" });
    expect(u!.password_hash).not.toContain("Sup3r-Secret!");
    expect(await verifyPassword("Sup3r-Secret!", u!.password_hash)).toBe(true);
    expect(await verifyPassword("wrong", u!.password_hash)).toBe(false);
    // and they can actually use the API as that tenant
    expect((await h.as(email).api("GET", "/api/me")).json.tenant.name).toBe("Initech LLC");
  });

  it("stored the seeded development admin's password as a verifiable hash", async () => {
    const [u] = await h.rows<{ password_hash: string }>("SELECT password_hash FROM users WHERE normalized_email = ?", h.adminEmail);
    expect(await verifyPassword("Password@123", u!.password_hash)).toBe(true);
  });

  it("is all-or-nothing: a duplicate email leaves no orphan tenant, a duplicate name leaves no orphan user", async () => {
    const taken = uniqueEmail("taken");
    await provisionTenant(db(), input("Atomic One", taken));

    await expect(provisionTenant(db(), input("Atomic Two", taken))).rejects.toMatchObject({ status: 409, code: "EMAIL_EXISTS" });
    expect(await h.rows("SELECT id FROM tenants WHERE slug = ?", "atomic-two")).toEqual([]); // the tenant was rolled back

    const fresh = uniqueEmail("fresh");
    await expect(provisionTenant(db(), input("ATOMIC ONE", fresh))).rejects.toMatchObject({ status: 409, code: "TENANT_EXISTS" });
    expect(await h.rows("SELECT id FROM users WHERE normalized_email = ?", fresh)).toEqual([]); // the user was rolled back
  });

  it("rejects a duplicate identifier", async () => {
    await provisionTenant(db(), { name: "Slug Holder", slug: "taken-slug", admin: { email: uniqueEmail(), password: "Sup3r-Secret!" } });
    await expect(provisionTenant(db(), { name: "Slug Taker", slug: "taken-slug", admin: { email: uniqueEmail(), password: "Sup3r-Secret!" } }))
      .rejects.toMatchObject({ status: 409, code: "TENANT_EXISTS" });
  });

  it("validates its input before writing anything", async () => {
    const before = (await h.rows<{ n: number }>("SELECT count(*) AS n FROM tenants"))[0]!.n;
    const bad: [string, ReturnType<typeof input>][] = [
      ["blank name", input("   ", uniqueEmail())],
      ["huge name", input("x".repeat(201), uniqueEmail())],
      ["bad email", input("Valid Name Co", "not-an-email")],
      ["short password", input("Valid Name Co", uniqueEmail(), "short")],
    ];
    for (const [label, args] of bad) {
      await expect(provisionTenant(db(), args), label).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    }
    expect((await h.rows<{ n: number }>("SELECT count(*) AS n FROM tenants"))[0]!.n).toBe(before);
  });
});
