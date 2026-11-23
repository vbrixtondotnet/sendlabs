import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness";

let h: Harness;

type Row = [id: string, first: string, title: string, company: string, email: string, employees: number | null, industry: string, city: string, state: string, country: string];

// A small, known directory: 60 filler people in "US" (the way the imported leads are stored) plus a few specific ones.
const FILLER: Row[] = Array.from({ length: 60 }, (_, i) => [
  `f${String(i).padStart(2, "0")}`, `Filler${i}`, "Owner", `Filler Co ${String(i).padStart(2, "0")}`, `filler${i}@filler.test`, 50, i % 2 ? "Bookkeeping" : "Plumbing", "Austin", "TX", "US",
]);
const SPECIAL: Row[] = [
  ["s1", "Acme Inc", "Marketing Manager", "Acme Inc", "secret1@acme.test", 8, "Software", "Berlin", "", "Germany"],
  ["s2", "Beta Ltd", "CEO", "Beta Ltd", "secret2@beta.test", 300, "Software", "Toronto", "ON", "Canada"],
  ["s3", "Gamma", "Head of 100% Growth", "Gamma", "secret3@gamma.test", 6000, "Retail", "London", "", "United Kingdom"],
  ["s4", "Delta", "Owner", "Delta", "secret4@delta.test", null, "Retail", "", "", "us"],
];

beforeAll(async () => {
  h = await startHarness();
  for (const [id, first, title, company, email, employees, industry, city, state, country] of [...FILLER, ...SPECIAL]) {
    await h.sql(
      "INSERT INTO global_contacts (id, first_name, last_name, title, company, email, employee_count, industry, website, city, state, country, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, first, "", title, company, email, employees, industry, "", city, state, country, 1, 1,
    );
  }
});
afterAll(async () => { await h.dispose(); });

type Person = { id: string; companyName: string; title: string; employees: number | null; industry: string; country: string };
const search = (qs = "") => h.api("GET", `/api/people${qs}`);
const ids = (r: { json: { items: Person[] } }) => r.json.items.map((p) => p.id).sort();

describe("GET /api/people (reads global_contacts)", () => {
  it("returns people from the table, with the columns the page needs and never the email address", async () => {
    const r = await search("?countries=Germany");
    expect(r.status).toBe(200);
    expect(r.json.items).toHaveLength(1);
    expect(r.json.items[0]).toEqual({ id: "s1", firstName: "Acme Inc", lastName: "", title: "Marketing Manager", companyName: "Acme Inc", employees: 8, industry: "Software", website: "", city: "Berlin", state: "", country: "Germany" });
    expect(JSON.stringify(r.json)).not.toMatch(/secret\d@|email/);
  });

  describe("server-side paging", () => {
    it("reads one page at a time and reports the total of all matches", async () => {
      const first = await search("?pageSize=25&page=1");
      expect(first.json).toMatchObject({ page: 1, pageSize: 25, total: 64 });
      expect(first.json.items).toHaveLength(25);
      const last = await search("?pageSize=25&page=3");
      expect(last.json.items).toHaveLength(14); // 64 = 25 + 25 + 14
      const beyond = await search("?pageSize=25&page=4");
      expect(beyond.json).toMatchObject({ total: 64, items: [] });
    });

    it("never repeats or skips a row across pages, in a stable order", async () => {
      const seen: string[] = [];
      for (const page of [1, 2, 3]) seen.push(...(await search(`?pageSize=25&page=${page}`)).json.items.map((p: Person) => p.id));
      expect(new Set(seen).size).toBe(64);
      const companies = (await search("?pageSize=100")).json.items.map((p: Person) => p.companyName);
      expect(companies).toEqual([...companies].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      expect((await search("?pageSize=25&page=2")).json.items).toEqual((await search("?pageSize=25&page=2")).json.items);
    });

    it("keeps the total and the paging when filters are applied", async () => {
      const r = await search("?industries=Bookkeeping&pageSize=10&page=3");
      expect(r.json).toMatchObject({ total: 30, page: 3 });
      expect(r.json.items).toHaveLength(10);
      expect(r.json.items.every((p: Person) => p.industry === "Bookkeeping")).toBe(true);
    });

    it("limits the page size", async () => {
      expect((await search("?pageSize=101")).status).toBe(400);
      expect((await search("?pageSize=100")).json.items).toHaveLength(64);
    });
  });

  describe("filters", () => {
    it("country: any of several, and a country the leads store as US", async () => {
      expect(ids(await search("?countries=Canada,Germany"))).toEqual(["s1", "s2"]);
      const us = await search("?countries=United States&pageSize=100");
      expect(us.json.total).toBe(61); // the 60 stored as "US" and the one stored as "us"
      expect(ids(await search("?countries=United Kingdom"))).toEqual(["s3"]);
    });

    it("industry: any of several", async () => {
      expect(ids(await search("?industries=Software"))).toEqual(["s1", "s2"]);
      expect(ids(await search("?industries=Software,Retail&pageSize=100"))).toEqual(["s1", "s2", "s3", "s4"]);
    });

    it("company size: a range, an open-ended range, and unknown sizes are left out of any range", async () => {
      expect(ids(await search("?companySize=1,10"))).toEqual(["s1"]);
      expect(ids(await search("?companySize=201,500"))).toEqual(["s2"]);
      expect(ids(await search("?companySize=5001,"))).toEqual(["s3"]);
      expect((await search("?companySize=11,50&pageSize=100")).json.total).toBe(60);
      expect(ids(await search("?companySize=5001,"))).not.toContain("s4"); // employee_count is null
    });

    it("job title: contains, any of several, ignoring case, and % is a plain character", async () => {
      expect(ids(await search("?titles=marketing"))).toEqual(["s1"]);
      expect(ids(await search("?titles=ceo,marketing manager"))).toEqual(["s1", "s2"]);
      expect(ids(await search("?titles=100%25"))).toEqual(["s3"]); // "100%" appears literally in one title
      expect((await search("?titles=%25")).json.total).toBe(1); // a lone "%" matches only titles containing a percent sign
    });

    it("combines filters, and returns nothing (not an error) when no one matches", async () => {
      expect(ids(await search("?countries=Germany&industries=Software&companySize=1,10&titles=marketing"))).toEqual(["s1"]);
      const none = await search("?countries=Germany&industries=Retail");
      expect(none.status).toBe(200);
      expect(none.json).toMatchObject({ total: 0, items: [] });
    });

    it("rejects values it does not understand", async () => {
      expect((await search("?companySize=7,9")).status).toBe(400);
      expect((await search("?page=0")).status).toBe(400);
    });
  });
});

describe("GET /api/people/industries", () => {
  it("lists each industry once, alphabetically, for the filter", async () => {
    const r = await h.api("GET", "/api/people/industries");
    expect(r.status).toBe(200);
    expect(r.json.items).toEqual(["Bookkeeping", "Plumbing", "Retail", "Software"]);
  });
});
