import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.dispose(); });

const insert = (id: string, email: string, employeeCount: number | null = 10) =>
  h.sql(
    "INSERT INTO global_contacts (id, first_name, last_name, title, company, email, employee_count, industry, website, city, state, country, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, "Ava", "Smith", "CEO", "Summit Group", email, employeeCount, "Retail", "https://summit.example", "Austin", "Texas", "United States", 1, 1,
  );

describe("global_contacts", () => {
  it("has the requested columns, and no tenant", async () => {
    const cols = (await h.rows<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'global_contacts' ORDER BY ordinal_position")).map((c) => c.column_name);
    expect(cols).toEqual(["id", "first_name", "last_name", "title", "company", "email", "employee_count", "industry", "website", "city", "state", "country", "created_at", "updated_at"]);
    expect(cols).not.toContain("tenant_id");
  });

  it("stores and returns a person, with the text columns defaulting to empty and the employee count optional", async () => {
    await insert("g1", "ava@summit.example", 1400);
    await h.sql("INSERT INTO global_contacts (id, created_at, updated_at) VALUES ('g-bare', 1, 1)");
    const [full] = await h.rows<Record<string, unknown>>("SELECT * FROM global_contacts WHERE id = 'g1'");
    expect(full).toMatchObject({ first_name: "Ava", company: "Summit Group", employee_count: 1400, country: "United States" });
    const [bare] = await h.rows<Record<string, unknown>>("SELECT * FROM global_contacts WHERE id = 'g-bare'");
    expect(bare).toMatchObject({ first_name: "", email: "", employee_count: null, country: "" });
  });

  it("holds one row per email address, ignoring case and spaces, but allows many rows without an email", async () => {
    await insert("g2", "Dup@Example.test");
    await expect(insert("g3", " dup@example.test ")).rejects.toThrow(/global_contacts_email_uq|duplicate key/);
    await h.sql("INSERT INTO global_contacts (id, created_at, updated_at) VALUES ('g-no-email-1', 1, 1)");
    await h.sql("INSERT INTO global_contacts (id, created_at, updated_at) VALUES ('g-no-email-2', 1, 1)");
  });

  it("refuses a negative employee count", async () => {
    await expect(insert("g4", "neg@example.test", -1)).rejects.toThrow(/global_contacts_employee_count_chk|check constraint/);
  });
});
