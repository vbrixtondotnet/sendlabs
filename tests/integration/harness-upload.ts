import { readFileSync } from "node:fs";
import type { Caller } from "./harness";

/** The template's column order, used as the default mapping in tests. */
export const TEMPLATE_MAPPING = {
  firstName: 0, lastName: 1, title: 2, companyName: 3, email: 4, employees: 5, industry: 6,
  linkedinUrl: 7, website: 8, city: 9, state: 10, country: 11, annualRevenue: 12,
} as const;

export const publicFile = (name: string) => readFileSync(`public/${name}`, "utf8");

/** Posts multipart/form-data to /api/imports as `who` (the harness itself, or `h.as(email)`), like the browser does. */
export async function upload(
  who: Caller,
  opts: { filename?: string; text?: string | Uint8Array; mapping?: unknown; omit?: "file" | "mapping" } = {},
) {
  const form = new FormData();
  const body = opts.text ?? publicFile("template.csv");
  if (opts.omit !== "file") form.set("file", new File([body], opts.filename ?? "template.csv", { type: "text/csv" }));
  if (opts.omit !== "mapping") {
    form.set("mapping", typeof opts.mapping === "string" ? opts.mapping : JSON.stringify(opts.mapping ?? TEMPLATE_MAPPING));
  }
  return who.upload(form);
}

/** Builds a CSV with the template's columns. Row i has email `${prefix}${i}@example.test`. */
export function bigCsv(rows: number, prefix = "bulk", extra: (i: number) => string[] | null = () => null): string {
  const lines = ["First Name,Last Name,Title,Company Name,Email,# Employees,Industry,Person Linkedin Url,Website,City,State,Country,Annual Revenue"];
  for (let i = 0; i < rows; i++) {
    const row = extra(i) ?? [`First${i}`, `Last${i}`, "Owner", `Company ${i}, Inc.`, `${prefix}${i}@example.test`, String(10 + (i % 90)), "construction", `http://www.linkedin.com/in/p${i}`, `https://c${i}.example.test`, "Austin", "Texas", "United States", i % 3 === 0 ? "" : String(1_000_000 + i)];
    lines.push(row.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
