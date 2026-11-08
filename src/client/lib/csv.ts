/** CSV tools for the browser. Parsing and validation live in `@shared/csv` and are re-exported here. */
import { toCsv } from "@shared/csv";

export * from "@shared/csv";
export { isValidEmail, normalizeEmail } from "@shared/email";

/** Saves rows as a CSV download. The BOM makes Excel read UTF-8 correctly. */
export function downloadCsv(filename: string, rows: string[][]) {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
