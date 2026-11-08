/**
 * CSV parsing and validation for template.csv-shaped files. Pure functions with no DOM and no network.
 * The browser uses it for the live preview and the Worker uses it as the authority, so both always agree.
 */
import type { ContactFields, InvalidRow } from "./types";
import { isValidEmail, normalizeEmail } from "./email";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 20_000;

/* ------------------------------ parsing ------------------------------ */

/** RFC 4180 parser: quoted fields, escaped quotes, embedded newlines, CRLF/LF/CR, UTF-8 BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const endRow = () => {
    row.push(cell);
    cell = "";
    // Skip fully empty lines
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      i++;
    } else {
      cell += ch;
      i++;
    }
  }
  if (inQuotes) throw new Error('The file has an unclosed quote. Check for a stray " character.');
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/** Quote a cell and neutralize spreadsheet formula injection (=, +, -, @ prefixes). */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/* ------------------------------ mapping ------------------------------ */

export type FieldKey = keyof ContactFields;

export interface FieldDef {
  key: FieldKey;
  label: string;
  required?: boolean;
  /** Normalized header aliases (lower-case, letters and digits only). */
  aliases: string[];
}

/** Order and names follow template.csv. */
export const FIELDS: FieldDef[] = [
  { key: "firstName", label: "First Name", aliases: ["firstname", "first", "givenname"] },
  { key: "lastName", label: "Last Name", aliases: ["lastname", "last", "surname", "familyname"] },
  { key: "title", label: "Title", aliases: ["title", "jobtitle", "position"] },
  { key: "companyName", label: "Company Name", aliases: ["companyname", "company", "organization", "organisation"] },
  { key: "email", label: "Email", required: true, aliases: ["email", "emailaddress", "workemail", "mail"] },
  { key: "employees", label: "# Employees", aliases: ["employees", "numberofemployees", "employeecount", "headcount"] },
  { key: "industry", label: "Industry", aliases: ["industry", "sector"] },
  { key: "linkedinUrl", label: "Person Linkedin Url", aliases: ["personlinkedinurl", "linkedinurl", "linkedin", "linkedinprofile"] },
  { key: "website", label: "Website", aliases: ["website", "url", "companywebsite", "domain"] },
  { key: "city", label: "City", aliases: ["city", "town"] },
  { key: "state", label: "State", aliases: ["state", "province", "region"] },
  { key: "country", label: "Country", aliases: ["country"] },
  { key: "annualRevenue", label: "Annual Revenue", aliases: ["annualrevenue", "revenue"] },
];

export type Mapping = Partial<Record<FieldKey, number>>; // field -> column index

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function autoMap(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<number>();
  for (const f of FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && f.aliases.includes(norm(h)));
    if (idx >= 0) {
      mapping[f.key] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

/* ---------------------------- validation ---------------------------- */

// Email rules are shared with the API so the UI and the server always agree.
export { isValidEmail, normalizeEmail };

/** A validated contact. `email` is normalized, `rawEmail` is the trimmed text from the file, `row` is its spreadsheet row (header = 1). */
export type ValidContact = ContactFields & { rawEmail: string; row: number };

export interface ValidationResult {
  valid: ValidContact[];
  invalid: InvalidRow[];
  total: number;
  counts: { valid: number; blank: number; malformed: number; duplicate: number; badRow: number };
  /** Rows kept, but with a non-numeric # Employees / Annual Revenue left blank. */
  numericWarnings: number;
}

const toNumber = (v: string): number | null | "bad" => {
  const t = v.trim().replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? Math.round(n) : "bad";
};

/**
 * @param dataRows     rows after the header. Row numbers in results are spreadsheet-style (header = row 1).
 * @param headerLength number of header columns. Rows with MORE cells are rejected (usually an unquoted comma).
 */
export function validateRows(dataRows: string[][], headerLength: number, mapping: Mapping): ValidationResult {
  const result: ValidationResult = {
    valid: [],
    invalid: [],
    total: dataRows.length,
    counts: { valid: 0, blank: 0, malformed: 0, duplicate: 0, badRow: 0 },
    numericWarnings: 0,
  };
  const emailIdx = mapping.email;
  if (emailIdx === undefined) return result;
  const seen = new Set<string>();
  const get = (r: string[], k: FieldKey) => {
    const i = mapping[k];
    return i === undefined ? "" : (r[i] ?? "").trim();
  };

  dataRows.forEach((r, i) => {
    const row = i + 2;
    const raw = (r[emailIdx] ?? "").trim();
    if (r.length > headerLength) {
      result.invalid.push({ row, raw, reason: "Bad row" });
      result.counts.badRow++;
      return;
    }
    if (raw === "") {
      result.invalid.push({ row, raw, reason: "Blank" });
      result.counts.blank++;
      return;
    }
    const email = normalizeEmail(raw);
    if (!isValidEmail(email)) {
      result.invalid.push({ row, raw, reason: "Malformed" });
      result.counts.malformed++;
      return;
    }
    if (seen.has(email)) {
      result.invalid.push({ row, raw, reason: "Duplicate" });
      result.counts.duplicate++;
      return;
    }
    seen.add(email);
    const emp = toNumber(get(r, "employees"));
    const rev = toNumber(get(r, "annualRevenue"));
    if (emp === "bad" || rev === "bad") result.numericWarnings++;
    result.valid.push({
      rawEmail: raw,
      row,
      email,
      firstName: get(r, "firstName"),
      lastName: get(r, "lastName"),
      title: get(r, "title"),
      companyName: get(r, "companyName"),
      employees: emp === "bad" ? null : emp,
      industry: get(r, "industry"),
      linkedinUrl: get(r, "linkedinUrl"),
      website: get(r, "website"),
      city: get(r, "city"),
      state: get(r, "state"),
      country: get(r, "country"),
      annualRevenue: rev === "bad" ? null : rev,
    });
    result.counts.valid++;
  });
  return result;
}

export function invalidReportRows(invalid: InvalidRow[]): string[][] {
  return [["Row", "Value", "Reason"], ...invalid.map((r) => [String(r.row), r.raw, r.reason])];
}

/* ------------------------------ whole file ------------------------------ */

export type ParsedCsvFile = { ok: true; headers: string[]; rows: string[][] } | { ok: false; error: string };

/**
 * Parses file text and applies the checks every upload must pass: not a binary file renamed to .csv,
 * well-formed quoting, a header plus at least one data row, and within the row limit.
 */
export function parseCsvFile(text: string): ParsedCsvFile {
  if (text.startsWith("PK\u0003\u0004") || text.includes("\u0000")) {
    return { ok: false, error: "This looks like a binary file, not a CSV. If it is an Excel workbook, use Save As and choose CSV UTF-8." };
  }
  let parsed: string[][];
  try {
    parsed = parseCsv(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The file could not be read." };
  }
  if (parsed.length < 2) return { ok: false, error: "The file needs a header row and at least one data row." };
  const [headerRow = [], ...rows] = parsed;
  if (rows.length > MAX_ROWS) {
    return { ok: false, error: `The file has ${rows.length.toLocaleString("en-US")} rows. The limit is ${MAX_ROWS.toLocaleString("en-US")}. Split it into smaller files.` };
  }
  return { ok: true, headers: headerRow.map((h) => h.trim()), rows };
}
