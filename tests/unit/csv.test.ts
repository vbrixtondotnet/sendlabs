import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { autoMap, csvCell, parseCsv, toCsv, validateRows } from "../../src/shared/csv";

const load = (file: string) => {
  const [header = [], ...rows] = parseCsv(readFileSync(`public/${file}`, "utf8"));
  const mapping = autoMap(header);
  return { header, rows, mapping, result: validateRows(rows, header.length, mapping) };
};

describe("template.csv", () => {
  const t = load("template.csv");

  it("maps all 13 columns automatically", () => {
    expect(t.header).toHaveLength(13);
    expect(Object.keys(t.mapping)).toHaveLength(13);
  });
  it("has 25 valid contacts and nothing rejected", () => {
    expect(t.result.counts).toEqual({ valid: 25, blank: 0, malformed: 0, duplicate: 0, badRow: 0 });
  });
  it("keeps quoted fields with commas intact", () => {
    const byEmail = (e: string) => t.result.valid.find((c) => c.email === e);
    expect(byEmail("nathanb@cesteel.com")?.companyName).toMatch(/^CUTTING EDGE STEEL, Inc\./);
    expect(byEmail("hdesai@kingwireinc.com")?.title).toBe("Vice President, Procurement");
  });
  it("parses numbers and turns blanks into null", () => {
    const nick = t.result.valid.find((c) => c.email === "nick@flexecutioninc.com");
    expect(nick).toMatchObject({ employees: 53, annualRevenue: 16175000 });
    expect(t.result.valid.find((c) => c.email === "julie@jcdavispower.com")?.annualRevenue).toBeNull();
  });
});

describe("sample-with-errors.csv", () => {
  const e = load("sample-with-errors.csv");
  it("classifies every bad row by reason, with spreadsheet row numbers", () => {
    expect(e.result.counts).toEqual({ valid: 26, blank: 1, malformed: 3, duplicate: 1, badRow: 1 });
    expect(e.result.invalid.map((i) => `${i.row}:${i.reason}`)).toEqual([
      "27:Malformed", "28:Blank", "29:Duplicate", "30:Malformed", "32:Bad row", "33:Malformed",
    ]);
  });
  it("keeps a row with non-numeric numbers, blanking them and warning", () => {
    expect(e.result.numericWarnings).toBe(1);
    expect(e.result.valid.find((c) => c.email === "lee.park@oddnumbers.example")).toMatchObject({ employees: null, annualRevenue: null });
  });
});

describe("parseCsv", () => {
  it("strips a BOM and handles LF, CR and CRLF", () => {
    expect(parseCsv("﻿a,b\r\n1,2")[0]).toEqual(["a", "b"]);
    expect(parseCsv("a\nb\rc\r\nd")).toHaveLength(4);
  });
  it("handles escaped quotes and embedded newlines", () => {
    expect(parseCsv('a,b\n"x ""y""","l1\nl2"')[1]).toEqual(['x "y"', "l1\nl2"]);
  });
  it("skips blank lines", () => {
    expect(parseCsv("a,b\n\n1,2\n\n")).toHaveLength(2);
  });
  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(/unclosed quote/);
  });
});

describe("csv output", () => {
  it("neutralizes spreadsheet formula injection", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });
  it("round-trips quoting", () => {
    expect(parseCsv(toCsv([["a", "b,c"], ["=x", 'q"r']]))).toEqual([["a", "b,c"], ["'=x", 'q"r']]);
  });
});
