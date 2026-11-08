/**
 * Loads sample data into the LOCAL API so the UI has something real to show.
 *
 *   npm run dev:api        (terminal 1)
 *   npm run seed:local     (terminal 2)
 *
 * It imports public/template.csv through the real import endpoint (the same path the UI uses) and
 * creates one sample draft campaign. Safe to run twice: existing contacts are skipped, and the campaign
 * is only created if it does not exist. It refuses to talk to anything but localhost.
 */
import { readFileSync } from "node:fs";
import { autoMap, parseCsv } from "../src/shared/csv";
import { DEFAULT_HTML_BODY } from "../src/shared/defaults";

const base = process.env["API_URL"] ?? "http://127.0.0.1:8787";
const host = new URL(base).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
  console.error(`Refusing to seed ${base}: this script only targets a local API.`);
  process.exit(1);
}

async function call(method: string, path: string, body?: unknown) {
  const init: RequestInit =
    body === undefined ? { method } : body instanceof FormData ? { method, body } : { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } };
  const res = await fetch(base + path, init);
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json: json as any };
}

const health = await call("GET", "/api/health").catch(() => null);
if (!health || health.status !== 200) {
  console.error(`The API is not reachable at ${base}. Start it with: npm run dev:api`);
  process.exit(1);
}

const text = readFileSync("public/template.csv", "utf8");
const mapping = autoMap(parseCsv(text)[0] ?? []);
const form = new FormData();
form.set("file", new File([text], "template.csv", { type: "text/csv" }));
form.set("mapping", JSON.stringify(mapping));

const imported = await call("POST", "/api/imports", form);
if (imported.status !== 201) {
  console.error(`Import failed (${imported.status}):`, JSON.stringify(imported.json));
  process.exit(1);
}
const i = imported.json;
console.log(`Import: ${i.createdContacts} contacts created, ${i.existingContacts} already existed, ${i.rejectedRows} rejected (of ${i.totalRows} rows).`);

const name = "Sample: Access-to-SQL outreach";
const found = await call("GET", `/api/campaigns?q=${encodeURIComponent(name)}`);
if (found.json.total === 0) {
  const r = await call("POST", "/api/campaigns", {
    name,
    subject: "{{firstName}}, is your Access database holding {{companyName}} back?",
    htmlBody: DEFAULT_HTML_BODY,
    recipientImportId: i.id,
  });
  console.log(r.status === 201 ? `Campaign: created draft "${name}", recipients = this import.` : `Campaign: failed (${r.status}) ${JSON.stringify(r.json)}`);
} else {
  console.log(`Campaign: "${name}" already exists.`);
}
