import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, uniqueEmail, type Harness } from "./harness";
import { bigCsv, publicFile, TEMPLATE_MAPPING, upload } from "./harness-upload";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.dispose(); });

const contactCount = async () => (await h.api("GET", "/api/contacts?pageSize=1")).json.total as number;

describe("importing the template", () => {
  it("creates every valid contact, links them to the import, and reports authoritative counts", async () => {
    const before = await contactCount();
    const r = await upload(h);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      filename: "template.csv", status: "Completed", totalRows: 25, validRows: 25, createdContacts: 25, existingContacts: 0,
      rejectedRows: 0, numericWarnings: 0, createdBy: h.adminEmail, error: null,
      counts: { malformed: 0, badRow: 0, duplicate: 0, blank: 0 },
    });
    expect(r.json.fileSize).toBeGreaterThan(1000);
    expect(r.json.completedAt).not.toBeNull();
    expect(r.json.columnMapping).toEqual(TEMPLATE_MAPPING);
    expect(await contactCount()).toBe(before + 25);

    const c = (await h.api("GET", "/api/contacts?q=nathanb@cesteel.com")).json.items[0];
    expect(c.companyName).toMatch(/^CUTTING EDGE STEEL, Inc\./); // a quoted comma survived the server-side parse
    expect(c.sourceImportId).toBe(r.json.id);
    expect(c.consentStatus).toBe("Unknown");
    expect(c).toMatchObject({ employees: 33, state: "Wyoming" });
  });

  it("is idempotent: importing the same file again creates nothing and overwrites nothing", async () => {
    const edited = (await h.api("GET", "/api/contacts?q=nick@flexecutioninc.com")).json.items[0];
    await h.api("PATCH", `/api/contacts/${edited.id}`, { title: "Edited after the first import" });

    const before = await contactCount();
    const r = await upload(h);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ validRows: 25, createdContacts: 0, existingContacts: 25 });
    expect(await contactCount()).toBe(before);
    const after = (await h.api("GET", `/api/contacts/${edited.id}`)).json;
    expect(after.title).toBe("Edited after the first import"); // existing details win
    expect(after.sourceImportId).toBe(edited.sourceImportId); // still attributed to the first import
  });

  it("keeps a row for every line, linked to its contact", async () => {
    const r = (await upload(h)).json;
    const rows = (await h.api("GET", `/api/imports/${r.id}/rows?pageSize=100`)).json;
    expect(rows.total).toBe(25);
    expect(rows.items.map((x: { rowNumber: number }) => x.rowNumber)).toEqual(Array.from({ length: 25 }, (_, i) => i + 2));
    expect(rows.items.every((x: { outcome: string; contactId: string | null }) => x.outcome === "Existing" && x.contactId !== null)).toBe(true);
  });
});

describe("rejected rows", () => {
  const errors = () => publicFile("sample-with-errors.csv");

  it("classifies every bad row, and still imports the good ones", async () => {
    const r = await upload(h, { filename: "errors.csv", text: errors() });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      totalRows: 32, validRows: 26, createdContacts: 1, existingContacts: 25, rejectedRows: 6, numericWarnings: 1,
      counts: { malformed: 3, badRow: 1, duplicate: 1, blank: 1 },
    });
    expect(r.json.createdContacts + r.json.existingContacts).toBe(r.json.validRows);

    const rejected = (await h.api("GET", `/api/imports/${r.json.id}/rows?show=rejected`)).json;
    expect(rejected.items.map((x: { rowNumber: number; outcome: string }) => `${x.rowNumber}:${x.outcome}`)).toEqual([
      "27:Malformed", "28:Blank", "29:Duplicate", "30:Malformed", "32:Bad row", "33:Malformed",
    ]);
    expect(rejected.items.every((x: { contactId: unknown }) => x.contactId === null)).toBe(true);
    expect(rejected.items[0].value).toBe("maria.lopez@baddomain");
  });

  it("filters rows by outcome and paginates them", async () => {
    const id = (await upload(h, { filename: "errors2.csv", text: errors() })).json.id;
    const mal = (await h.api("GET", `/api/imports/${id}/rows?outcome=Malformed`)).json;
    expect(mal.total).toBe(3);
    const p2 = (await h.api("GET", `/api/imports/${id}/rows?show=rejected&pageSize=4&page=2`)).json;
    expect(p2.total).toBe(6);
    expect(p2.items).toHaveLength(2);
    expect((await h.api("GET", `/api/imports/${id}/rows?outcome=Delivered`)).status).toBe(400);
  });

  it("serves the rejected rows as a downloadable CSV", async () => {
    const id = (await upload(h, { filename: "My Leads (final).csv", text: errors() })).json.id;
    const r = await h.text(`/api/imports/${id}/rejected-rows.csv`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="My_Leads__final_-rejected-rows.csv"');
    expect(r.headers.get("cache-control")).toBe("no-store");
    const lines = r.body.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Row,Value,Reason");
    expect(lines).toContain("27,maria.lopez@baddomain,Malformed");
    expect(lines).toContain("32,kim@@doubleat.example,Bad row".replace("kim@@doubleat.example", "sam@commaproblem.example"));
    expect(lines).toHaveLength(7);
  });

  it("neutralizes spreadsheet formulas in the downloaded report", async () => {
    const text = bigCsv(3, "inj", (i) => (i === 1 ? ["A", "B", "T", "C", "=HYPERLINK(\"http://evil.test\")", "1", "x", "", "", "", "", "", ""] : null));
    const id = (await upload(h, { filename: "inj.csv", text })).json.id;
    const body = (await h.text(`/api/imports/${id}/rejected-rows.csv`)).body;
    expect(body).toContain(`"'=HYPERLINK(""http://evil.test"")"`);
    expect(body).not.toMatch(/,=HYPERLINK/);
  });

  it("matches existing contacts regardless of letter case, and detects in-file duplicates the same way", async () => {
    const mail = uniqueEmail("case");
    await h.api("POST", "/api/contacts", { email: mail, title: "Original" });
    const text = bigCsv(3, "x", (i) => [`N${i}`, "L", "T", "C", i === 0 ? mail.toUpperCase() : i === 1 ? ` ${mail} ` : `other${i}@example.test`, "", "", "", "", "", "", "", ""]);
    const r = (await upload(h, { filename: "case.csv", text })).json;
    expect(r).toMatchObject({ validRows: 2, createdContacts: 1, existingContacts: 1, counts: { duplicate: 1 } });
    expect((await h.api("GET", `/api/contacts?q=${mail}`)).json.items[0].title).toBe("Original");
  });

  it("truncates a huge junk value instead of storing it", async () => {
    const text = bigCsv(1, "j", () => ["A", "B", "T", "C", "z".repeat(2000), "", "", "", "", "", "", "", ""]);
    const id = (await upload(h, { filename: "junk.csv", text })).json.id;
    const row = (await h.api("GET", `/api/imports/${id}/rows`)).json.items[0];
    expect(row.outcome).toBe("Malformed");
    expect(row.value).toHaveLength(500);
  });

  it("imports nothing but still records an import when every row is bad", async () => {
    const text = bigCsv(2, "n", (i) => ["A", "B", "T", "C", i === 0 ? "" : "not-an-email", "", "", "", "", "", "", "", ""]);
    const r = await upload(h, { filename: "allbad.csv", text });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ validRows: 0, createdContacts: 0, rejectedRows: 2, status: "Completed" });
  });
});

describe("mapping", () => {
  it("honours a different column layout", async () => {
    const text = "Mail,Name,Org\r\nswap1@example.test,Pat,Acme\r\nswap2@example.test,Sam,Beta\r\n";
    const r = await upload(h, { filename: "swapped.csv", text, mapping: { email: 0, firstName: 1, companyName: 2 } });
    expect(r.json).toMatchObject({ validRows: 2, createdContacts: 2, columnMapping: { email: 0, firstName: 1, companyName: 2 } });
    const c = (await h.api("GET", "/api/contacts?q=swap1@example.test")).json.items[0];
    expect(c).toMatchObject({ firstName: "Pat", companyName: "Acme", lastName: "" });
  });

  it("rejects a bad mapping with field-level errors", async () => {
    const cases: [unknown, string][] = [
      [{ firstName: 0 }, "email"], // email is required
      [{ email: 99 }, "email"], // beyond the file's 13 columns
      [{ email: 4, nickname: 1 }, ""], // unknown key
      [{ email: -1 }, "email"],
      [{ email: "4" }, "email"],
      ["not json", ""],
    ];
    for (const [mapping, path] of cases) {
      const r = await upload(h, { mapping });
      expect(r.status, JSON.stringify(mapping)).toBe(400);
      expect(r.json.error.code).toBe("VALIDATION_ERROR");
      if (path) expect(r.json.error.details.map((d: { path: string }) => d.path)).toContain(path);
    }
  });
});

describe("rejecting bad uploads", () => {
  const before = async () => (await h.api("GET", "/api/imports")).json.total as number;

  it("refuses wrong, empty, binary and malformed files, and records nothing", async () => {
    const total = await before();
    const cases: [string, Parameters<typeof upload>[1], number, string][] = [
      ["not a csv extension", { filename: "leads.xlsx", text: "a,b\n1,2" }, 400, "INVALID_FILE"],
      ["empty file", { filename: "e.csv", text: "" }, 400, "INVALID_FILE"],
      ["excel renamed to csv", { filename: "x.csv", text: "PK\u0003\u0004binary" }, 422, "INVALID_CSV"],
      ["NUL bytes", { filename: "n.csv", text: "a,b\n1,\u00002" }, 422, "INVALID_CSV"],
      ["header only", { filename: "h.csv", text: "Email\r\n" }, 422, "INVALID_CSV"],
      ["unclosed quote", { filename: "q.csv", text: 'Email\n"oops@example.test' }, 422, "INVALID_CSV"],
      ["too many rows", { filename: "big.csv", text: bigCsv(20_001, "toomany") }, 422, "INVALID_CSV"],
    ];
    for (const [name, opts, status, code] of cases) {
      const r = await upload(h, { mapping: { email: 0 }, ...opts });
      expect(r.status, name).toBe(status);
      expect(r.json.error.code, name).toBe(code);
    }
    expect(await before()).toBe(total); // nothing was recorded for any of them
  });

  it("refuses a request without the file or mapping fields, or without multipart", async () => {
    expect((await upload(h, { omit: "file" })).json.error.code).toBe("INVALID_UPLOAD");
    expect((await upload(h, { omit: "mapping" })).json.error.code).toBe("INVALID_UPLOAD");
    const r = await h.api("POST", "/api/imports", { csv: "a" });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("INVALID_UPLOAD");
  });

  it("refuses an upload over the size limit with 413", async () => {
    const huge = "Email\r\n" + "a@example.test\r\n".repeat(900_000); // ~13.5 MB
    const r = await upload(h, { filename: "huge.csv", text: huge, mapping: { email: 0 } });
    expect(r.status).toBe(413);
  });

  it("fails closed outside the local environment", async () => {
    const r = await upload(h.withEnv({ ENVIRONMENT: "production" }));
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("AUTH_NOT_CONFIGURED");
  });
});

describe("history", () => {
  it("lists imports newest first, and gets one", async () => {
    const a = (await upload(h, { filename: "history-a.csv", text: bigCsv(2, "ha") })).json;
    await new Promise((r) => setTimeout(r, 5));
    const b = (await upload(h, { filename: "history-b.csv", text: bigCsv(2, "hb") })).json;
    const list = (await h.api("GET", "/api/imports?pageSize=2")).json;
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);
    expect(list.total).toBeGreaterThan(2);
    expect((await h.api("GET", `/api/imports/${a.id}`)).json.filename).toBe("history-a.csv");
    expect((await h.api("GET", "/api/imports/nope")).status).toBe(404);
    expect((await h.api("GET", "/api/imports/nope/rows")).status).toBe(404);
    expect((await h.text("/api/imports/nope/rejected-rows.csv")).status).toBe(404);
  });
});

describe("campaign recipients from an import", () => {
  const campaign = { name: "From import", subject: "s", htmlBody: "<p>b</p>" };

  it("saves chosen industries, copies them, and refuses to combine them with an import", async () => {
    const made = await h.api("POST", "/api/campaigns", { ...campaign, recipientIndustries: ["construction", "retail"] });
    expect(made.status).toBe(201);
    expect(made.json.recipientIndustries).toEqual(["construction", "retail"]);
    expect((await h.api("GET", `/api/campaigns/${made.json.id}`)).json.recipientIndustries).toEqual(["construction", "retail"]);
    expect((await h.api("POST", `/api/campaigns/${made.json.id}/duplicate`)).json.recipientIndustries).toEqual(["construction", "retail"]);
    expect((await h.api("POST", "/api/campaigns", campaign)).json.recipientIndustries).toEqual([]); // default: not used

    const imp = (await upload(h, { filename: "ind.csv", text: bigCsv(2, "ind") })).json;
    expect((await h.api("POST", "/api/campaigns", { ...campaign, recipientImportId: imp.id, recipientIndustries: ["retail"] })).status).toBe(400);
    expect((await h.api("PATCH", `/api/campaigns/${made.json.id}`, { recipientImportId: imp.id })).status).toBe(400); // merged with the stored industries
    const cleared = await h.api("PATCH", `/api/campaigns/${made.json.id}`, { recipientImportId: imp.id, recipientIndustries: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.json.recipientIndustries).toEqual([]);
  });

  it("defaults to all contacts, and saves a chosen import", async () => {
    const imp = (await upload(h, { filename: "recipients.csv", text: bigCsv(3, "rcp") })).json;
    const all = await h.api("POST", "/api/campaigns", campaign);
    expect(all.json.recipientImportId).toBeNull();
    const chosen = await h.api("POST", "/api/campaigns", { ...campaign, recipientImportId: imp.id });
    expect(chosen.status).toBe(201);
    expect(chosen.json.recipientImportId).toBe(imp.id);
    expect((await h.api("GET", `/api/campaigns/${chosen.json.id}`)).json.recipientImportId).toBe(imp.id);
    const summary = (await h.api("GET", "/api/campaigns?q=From%20import&pageSize=50")).json.items.find((c: { id: string }) => c.id === chosen.json.id);
    expect(summary.recipientImportId).toBe(imp.id);
  });

  it("can be changed or cleared on a draft, and is copied by duplicate", async () => {
    const imp = (await upload(h, { filename: "r2.csv", text: bigCsv(2, "rc2") })).json;
    const c = (await h.api("POST", "/api/campaigns", campaign)).json;
    expect((await h.api("PATCH", `/api/campaigns/${c.id}`, { recipientImportId: imp.id })).json.recipientImportId).toBe(imp.id);
    const copy = (await h.api("POST", `/api/campaigns/${c.id}/duplicate`)).json;
    expect(copy.recipientImportId).toBe(imp.id);
    expect((await h.api("PATCH", `/api/campaigns/${c.id}`, { recipientImportId: null })).json.recipientImportId).toBeNull();
  });

  it("refuses an import that does not exist or did not complete", async () => {
    const missing = await h.api("POST", "/api/campaigns", { ...campaign, recipientImportId: "nope" });
    expect(missing.status).toBe(400);
    expect(missing.json.error.details[0].path).toBe("recipientImportId");

    const imp = (await upload(h, { filename: "failed.csv", text: bigCsv(2, "fl") })).json;
    await h.sql("UPDATE imports SET status='Failed' WHERE id=?", imp.id);
    expect((await h.api("POST", "/api/campaigns", { ...campaign, recipientImportId: imp.id })).status).toBe(400);
    const c = (await h.api("POST", "/api/campaigns", campaign)).json;
    expect((await h.api("PATCH", `/api/campaigns/${c.id}`, { recipientImportId: imp.id })).status).toBe(400);
  });
});

describe("scale", () => {
  it("imports an 8,000-row file within D1's parameter and batch limits, with mixed good and bad rows", async () => {
    const rows = 8_000;
    const text = bigCsv(rows, "scale", (i) =>
      i % 100 === 7 ? ["A", "B", "T", "C", "bad-email", "", "", "", "", "", "", "", ""] // 80 malformed
      : i % 100 === 8 ? ["A", "B", "T", "C", `scale${i - 2}@example.test`, "", "", "", "", "", "", "", ""] // 80 in-file duplicates of an earlier valid row
      : null,
    );
    const before = await contactCount();
    const started = Date.now();
    const r = await upload(h, { filename: "scale.csv", text });
    const seconds = (Date.now() - started) / 1000;

    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ totalRows: rows, validRows: 7_840, createdContacts: 7_840, existingContacts: 0, rejectedRows: 160, counts: { malformed: 80, duplicate: 80 } });
    expect(await contactCount()).toBe(before + 7_840);
    const rowCount = (await h.api("GET", `/api/imports/${r.json.id}/rows?pageSize=1`)).json.total;
    expect(rowCount).toBe(rows); // a result for every single row
    expect((await h.api("GET", `/api/imports/${r.json.id}/rows?show=rejected&pageSize=1`)).json.total).toBe(160);
    console.log(`8,000-row import took ${seconds.toFixed(1)}s`);
    expect(seconds).toBeLessThan(60);

    // re-running the same file is safe
    const again = await upload(h, { filename: "scale.csv", text });
    expect(again.json).toMatchObject({ createdContacts: 0, existingContacts: 7_840 });
    expect(await contactCount()).toBe(before + 7_840);
  }, 120_000);
});
