import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.dispose(); });

type Person = { id: string; firstName: string; title: string; employees: number; industry: string; country: string; email: string };
const search = (qs = "") => h.api("GET", `/api/people${qs}`);

describe("GET /api/people (sample data until Apollo is connected)", () => {
  it("returns a page of people with every column the table needs, flagged as sample data", async () => {
    const r = await search("?pageSize=5");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ page: 1, pageSize: 5, source: "mock" });
    expect(r.json.total).toBeGreaterThan(50);
    expect(r.json.items).toHaveLength(5);
    expect(Object.keys(r.json.items[0]).sort()).toEqual(["city", "companyName", "country", "email", "employees", "firstName", "id", "industry", "lastName", "linkedinUrl", "state", "title", "website"]);
  });

  it("is the same list every time, so paging is stable", async () => {
    const a = await search("?pageSize=10&page=2");
    const b = await search("?pageSize=10&page=2");
    expect(a.json.items).toEqual(b.json.items);
    const first = await search("?pageSize=10&page=1");
    expect(first.json.items[0].id).not.toBe(a.json.items[0].id);
  });

  it("filters by several countries at once (any of them)", async () => {
    const r = await search("?countries=Canada,Germany&pageSize=100");
    expect(r.json.total).toBeGreaterThan(0);
    expect(new Set(r.json.items.map((p: Person) => p.country))).toEqual(new Set(["Canada", "Germany"]));
  });

  it("filters by industry, company size and job title, and combines them", async () => {
    const byIndustry = await search("?industry=Retail&pageSize=100");
    expect(byIndustry.json.items.every((p: Person) => p.industry === "Retail")).toBe(true);

    const bySize = await search("?companySize=51,200&pageSize=100");
    expect(bySize.json.total).toBeGreaterThan(0);
    expect(bySize.json.items.every((p: Person) => p.employees >= 51 && p.employees <= 200)).toBe(true);

    const open = await search("?companySize=5001,&pageSize=100"); // no upper limit
    expect(open.json.items.every((p: Person) => p.employees >= 5001)).toBe(true);

    const byTitle = await search("?titles=manager,ceo&pageSize=100");
    expect(byTitle.json.items.every((p: Person) => /manager|ceo/i.test(p.title))).toBe(true);

    const all = await search("?countries=United States&industry=Retail&titles=Manager&pageSize=100");
    expect(all.json.items.every((p: Person) => p.country === "United States" && p.industry === "Retail" && /manager/i.test(p.title))).toBe(true);
    expect(all.json.total).toBeLessThanOrEqual(byIndustry.json.total);
  });

  it("returns nothing, not an error, when no one matches", async () => {
    const r = await search("?countries=Greece&industry=Airlines/Aviation&companySize=5001,&titles=zzzz");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ total: 0, items: [] });
  });

  it("rejects values it does not know", async () => {
    expect((await search("?industry=Nonsense")).status).toBe(400);
    expect((await search("?companySize=7,9")).status).toBe(400);
    expect((await search("?pageSize=500")).status).toBe(400);
  });
});
