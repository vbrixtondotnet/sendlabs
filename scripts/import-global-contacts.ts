/**
 * Imports the "US Leads" sheet of an Excel file into the global_contacts table.
 *
 *   npm run db:import:global-contacts                          # ../assets/leads.xlsx into DATABASE_URL (.dev.vars)
 *   npm run db:import:global-contacts -- --file path/to/leads.xlsx --url "postgresql://..." [--dry-run]
 *
 * Column mapping (as requested):
 *   first_name = Business Name     last_name = ""          title = "Owner"      company = Business Name
 *   email = Email                  employee_count = 50     industry = category3 website = WebSite
 *   city = City                    state = State           country = "US"
 *
 * One transaction: everything is imported or nothing is. Safe to run again: an address already in the table (compared ignoring
 * case) is skipped, never duplicated or overwritten. Rows with a missing or malformed email are skipped and counted. With
 * --dry-run it does all of that and rolls back, so you can see the numbers first. The workbook holds real people's details and
 * lives outside the repository (the folder above it): it is never committed.
 */
import { resolve } from "node:path";
import readXlsxFile from "read-excel-file/node";
import { sql } from "drizzle-orm";
import { globalContacts, type NewGlobalContactRow } from "../src/server/database/schema";
import { isValidEmail } from "../src/shared/email";
import { arg, hasFlag, redact } from "./lib/env";
import { openDb } from "./lib/db";

const SHEET = "US Leads";
const EMPLOYEE_COUNT = 50;
const CHUNK = 500;
const file = resolve(arg("file") ?? "../assets/leads.xlsx");
const dryRun = hasFlag("dry-run");

/** A cell as trimmed text ("" for an empty one; numbers such as a postal code become their digits). */
const cell = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

// `getSheets` returns every sheet as { sheet, data }; the package's type declarations do not list it.
const sheets = (await readXlsxFile(file, { getSheets: true } as never)) as unknown as { sheet: string; data: unknown[][] }[];
const data = sheets.find((s) => s.sheet === SHEET)?.data;
if (!data) {
  console.error(`The workbook has no "${SHEET}" sheet. Found: ${sheets.map((s) => s.sheet).join(", ")}`);
  process.exit(1);
}

const header = (data[0] ?? []).map(cell);
const need = ["Business Name", "Email", "category3", "WebSite", "City", "State"];
const at = Object.fromEntries(need.map((n) => [n, header.indexOf(n)])) as Record<string, number>;
const missing = need.filter((n) => at[n] === -1);
if (missing.length) {
  console.error(`The "${SHEET}" sheet is missing the column(s): ${missing.join(", ")}`);
  process.exit(1);
}

const seen = new Set<string>();
const rows: NewGlobalContactRow[] = [];
let blankRows = 0;
let badEmail = 0;
let duplicateInFile = 0;
for (const r of data.slice(1)) {
  const get = (n: string) => cell(r[at[n]!]);
  if (r.every((c) => cell(c) === "")) { blankRows++; continue; }
  const email = get("Email");
  if (!isValidEmail(email)) { badEmail++; continue; }
  const key = email.toLowerCase();
  if (seen.has(key)) { duplicateInFile++; continue; }
  seen.add(key);
  rows.push({
    firstName: get("Business Name"),
    lastName: "",
    title: "Owner",
    company: get("Business Name"),
    email,
    employeeCount: EMPLOYEE_COUNT,
    industry: get("category3"),
    website: get("WebSite"),
    city: get("City"),
    state: get("State"),
    country: "US",
  });
}

const { db, url, close } = openDb();
class DryRun extends Error {}
try {
  console.log(`File:   ${file} (sheet "${SHEET}", ${data.length - 1} data rows)\nTarget: ${redact(url)}${dryRun ? "   (dry run: rolled back at the end)" : ""}\n`);
  let inserted = 0;
  try {
    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        // No conflict target: the unique rule is on lower(trim(email)), so any duplicate address is skipped.
        const done = await tx.insert(globalContacts).values(rows.slice(i, i + CHUNK)).onConflictDoNothing().returning({ id: globalContacts.id });
        inserted += done.length;
      }
      const [total] = (await tx.execute(sql`SELECT count(*)::int AS n FROM global_contacts`)) as unknown as { n: number }[];
      console.log(`global_contacts now holds ${total?.n ?? 0} row(s).`);
      if (dryRun) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  console.log(`\nImported:                       ${inserted}${dryRun ? " (rolled back)" : ""}`);
  console.log(`Already in the table (skipped): ${rows.length - inserted}`);
  console.log(`Duplicate email in the file:    ${duplicateInFile}`);
  console.log(`Missing or malformed email:     ${badEmail}`);
  console.log(`Blank rows:                     ${blankRows}`);
} catch (e) {
  console.error(`\nImport failed (nothing was changed): ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await close();
}
