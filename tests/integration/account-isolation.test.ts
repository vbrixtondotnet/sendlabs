import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness";

let h: Harness;
let other: { userId: string };
const OTHER = "second@example.test";

beforeAll(async () => {
  h = await startHarness();
  other = await h.addAccount("Second Co", OTHER);
});
afterAll(async () => { await h.dispose(); });

describe("the single-account model", () => {
  it("has no multi-tenancy tables left", async () => {
    const rows = await h.rows<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const names = rows.map((r) => r.table_name);
    for (const gone of ["tenants", "access", "invitations"]) expect(names, gone).not.toContain(gone);
    expect(names).toContain("users");
  });

  it("keeps each account's data to itself through the API", async () => {
    const mine = await h.api("POST", "/api/contacts", { email: "ann@example.test" });
    expect(mine.status).toBe(201);
    expect((await h.as(OTHER).api("GET", "/api/contacts")).json.total).toBe(0);
    expect((await h.as(OTHER).api("GET", `/api/contacts/${mine.json.id}`)).status).toBe(404);
  });

  it("makes the database refuse a row that points at another account's data", async () => {
    const c = await h.api("POST", "/api/campaigns", { name: "Mine", subject: "Hi", htmlBody: "<p>Hi</p>" });
    expect(c.status).toBe(201);
    await expect(
      h.sql(
        "INSERT INTO campaign_recipients (id,user_id,campaign_id,contact_id,email_snapshot,personalization_snapshot,sequence,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        "x1", other.userId, c.json.id, null, "a@example.test", "{}", 1, "Pending", 1, 1,
      ),
    ).rejects.toThrow(/foreign key|constraint/i);
  });

  it("refuses a second account with the same email, ignoring letter case", async () => {
    await expect(h.addAccount("Dup", OTHER.toUpperCase())).rejects.toMatchObject({ code: "EMAIL_EXISTS" });
  });
});
