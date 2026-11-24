import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PERSON_REVEAL_COST, STARTING_CREDITS } from "../../src/shared/credits";
import { startHarness, type Caller, type Harness } from "./harness";

/**
 * Credits: every user starts with STARTING_CREDITS, and "Add Contact" on the People page reveals the email address by making
 * the person one of the tenant's contacts, for PERSON_REVEAL_COST credit.
 */
let h: Harness;
let a: Caller; // Sabertooth Software Labs
let b: Caller; // Globex Corp
let userA = "";
let userB = "";
const bEmail = "admin@globex.test";

beforeAll(async () => {
  h = await startHarness();
  a = h;
  const B = await h.addAccount("Globex Corp", bEmail);
  b = h.as(bEmail);
  userA = (await h.rows<{ id: string }>("SELECT id FROM users WHERE normalized_email = ?", h.adminEmail))[0]!.id;
  userB = B.userId;
  const people: [string, string, string, string, number | null][] = [
    ["g1", "Ava", "Smith", "Ava@Summit.test", 1400],
    ["g2", "Liam", "Jones", "liam@summit.test", 20],
    ["g3", "Noah", "Brown", "noah@summit.test", null],
    ["g4", "Mia", "NoMail", "", 5],
    ["g5", "Eli", "Dup", "eli@summit.test", 7],
  ];
  for (const [id, first, last, email, employees] of people) {
    await h.sql(
      "INSERT INTO global_contacts (id, first_name, last_name, title, company, email, employee_count, industry, website, city, state, country, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, first, last, "CEO", "Summit " + first, email, employees, "Retail", "", "Austin", "TX", "United States", 1, 1,
    );
  }
});
afterAll(async () => { await h.dispose(); });

beforeEach(async () => {
  await h.sql("DELETE FROM credit_transactions");
  await h.sql("DELETE FROM campaign_recipients");
  await h.sql("DELETE FROM campaigns");
  await h.sql("DELETE FROM contacts");
  await h.sql("UPDATE users SET credits = ?", STARTING_CREDITS);
});

type Person = { id: string; email: string | null; hasEmail: boolean };
const credits = async (who: Caller) => (await who.api("GET", "/api/me")).json.user.credits as number;
const find = async (who: Caller, id: string) => ((await who.api("GET", "/api/people?pageSize=100")).json.items as Person[]).find((p) => p.id === id)!;
const add = (who: Caller, id: string) => who.api("POST", `/api/people/${id}/add-contact`);
const contactCount = async (userId = h.userId) => Number((await h.rows<{ n: string }>("SELECT count(*) AS n FROM contacts WHERE user_id = ?", userId))[0]!.n);

describe("the starting balance", () => {
  it("gives every user 100 credits, shown on /api/me", async () => {
    expect(STARTING_CREDITS).toBe(100);
    expect(await credits(a)).toBe(100);
    expect(await credits(b)).toBe(100);
  });
});

describe("the email address is hidden until the person is added", () => {
  it("searches without any email, and says whether there is one to reveal", async () => {
    const r = await a.api("GET", "/api/people?pageSize=100");
    expect(r.status).toBe(200);
    for (const p of r.json.items as Person[]) expect(p.email).toBeNull();
    expect((await find(a, "g1")).hasEmail).toBe(true);
    expect((await find(a, "g4")).hasEmail).toBe(false);
    expect(JSON.stringify(r.json)).not.toMatch(/summit\.test/i);
  });
});

describe("POST /api/people/:id/add-contact", () => {
  it("adds the person as a contact, reveals the email, takes 1 credit and writes the ledger", async () => {
    expect(PERSON_REVEAL_COST).toBe(1);
    const r = await add(a, "g1");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ charged: true, credits: 99, person: { id: "g1", email: "Ava@Summit.test", hasEmail: true } });
    expect(await credits(a)).toBe(99);

    const [c] = await h.rows<Record<string, unknown>>("SELECT * FROM contacts WHERE user_id = ?", h.userId);
    expect(c).toMatchObject({ id: r.json.contactId, email: "Ava@Summit.test", normalized_email: "ava@summit.test", first_name: "Ava", last_name: "Smith", company_name: "Summit Ava", country: "United States", employees: 1400, consent_status: "Unknown", consent_source: "People search" });
    const ledger = await h.rows<Record<string, unknown>>("SELECT * FROM credit_transactions");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ user_id: userA, delta: -1, balance_after: 99, reason: "people_reveal", global_contact_id: "g1", contact_id: r.json.contactId });
  });

  it("shows the email in later searches, and the person is in the contacts list", async () => {
    await add(a, "g1");
    expect((await find(a, "g1")).email).toBe("Ava@Summit.test");
    expect((await find(a, "g2")).email).toBeNull(); // others stay hidden
    const list = await a.api("GET", "/api/contacts?pageSize=100");
    expect(list.json.items.map((c: { email: string }) => c.email)).toEqual(["ava@summit.test"]); // the contacts list shows the normalized address
  });

  it("does not charge twice for the same person, even when clicked twice at the same moment", async () => {
    const [x, y] = await Promise.all([add(a, "g2"), add(a, "g2")]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect([x.json.charged, y.json.charged].filter(Boolean)).toHaveLength(1);
    expect(await credits(a)).toBe(99);
    expect(await contactCount()).toBe(1);
    expect(await h.rows("SELECT 1 FROM credit_transactions")).toHaveLength(1);
    const again = await add(a, "g2");
    expect(again.json).toMatchObject({ charged: false, credits: 99, contactId: x.json.contactId });
  });

  it("treats an address already in the contacts (however it got there, in any letter case) as added, free of charge", async () => {
    expect((await a.api("POST", "/api/contacts", { email: "ELI@Summit.test" })).status).toBe(201);
    expect((await find(a, "g5")).email).toBe("eli@summit.test"); // shown without paying
    const r = await add(a, "g5");
    expect(r.json).toMatchObject({ charged: false, credits: 100 });
    expect(await contactCount()).toBe(1);
  });

  it("each organization has its own contacts: another tenant still sees nothing, and pays for its own copy", async () => {
    await add(a, "g1");
    expect((await find(b, "g1")).email).toBeNull();
    const r = await add(b, "g1");
    expect(r.json).toMatchObject({ charged: true, credits: 99 });
    expect(await credits(a)).toBe(99);
    expect(await credits(b)).toBe(99);
    expect(await contactCount(h.userId)).toBe(1);
    expect(Number((await h.rows<{ n: string }>("SELECT count(*) AS n FROM contacts WHERE email = 'Ava@Summit.test'"))[0]!.n)).toBe(2);
    expect((await h.rows<{ user_id: string }>("SELECT user_id FROM credit_transactions ORDER BY created_at")).map((r) => r.user_id).sort()).toEqual([userA, userB].sort());
  });

  it("refuses a person with no email address, and charges nothing", async () => {
    const r = await add(a, "g4");
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("NO_EMAIL");
    expect(await credits(a)).toBe(100);
    expect(await contactCount()).toBe(0);
  });

  it("answers 404 for a person who is not in the directory", async () => {
    expect((await add(a, "nope")).status).toBe(404);
    expect(await credits(a)).toBe(100);
  });

  it("needs a signed-in user", async () => {
    expect((await h.anonymous.api("POST", "/api/people/g1/add-contact")).status).toBe(401);
  });
});

describe("running out of credits", () => {
  it("answers 402 and adds nothing at zero, and never goes below zero", async () => {
    await h.sql("UPDATE users SET credits = 0 WHERE id = ?", userA);
    const r = await add(a, "g1");
    expect(r.status).toBe(402);
    expect(r.json.error.code).toBe("INSUFFICIENT_CREDITS");
    expect(await credits(a)).toBe(0);
    expect(await contactCount()).toBe(0); // the whole thing rolled back
    expect(await h.rows("SELECT 1 FROM credit_transactions")).toHaveLength(0);
    expect((await find(a, "g1")).email).toBeNull();
  });

  it("with one credit left, two different people at the same moment: one succeeds, one is refused", async () => {
    await h.sql("UPDATE users SET credits = 1 WHERE id = ?", userA);
    const rs = await Promise.all([add(a, "g1"), add(a, "g2")]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 402]);
    expect(await credits(a)).toBe(0);
    expect(await contactCount()).toBe(1);
  });

  it("an address that is already a contact can still be revealed with zero credits", async () => {
    await a.api("POST", "/api/contacts", { email: "noah@summit.test" });
    await h.sql("UPDATE users SET credits = 0 WHERE id = ?", userA);
    const r = await add(a, "g3");
    expect(r.status).toBe(200);
    expect(r.json.charged).toBe(false);
  });

  it("the database itself refuses a negative balance", async () => {
    await expect(h.sql("UPDATE users SET credits = -1 WHERE id = ?", userA)).rejects.toThrow();
  });
});
