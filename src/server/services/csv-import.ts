import { MAX_FILE_BYTES, parseCsvFile, validateRows, type Mapping } from "../../shared/csv";
import type { ImportDto } from "../../shared/api";
import { importMappingSchema } from "../../shared/schemas";
import type { Database } from "../database/client";
import { contactsRepo } from "../database/repositories/contacts";
import { importsRepo, type RowResult } from "../database/repositories/imports";
import { ApiError, badRequest } from "../lib/errors";
import { formatIssues } from "../lib/http";

export interface UploadedCsv {
  filename: string;
  size: number;
  /** Decoded file text. */
  text: string;
  /** The raw `mapping` form field (JSON). */
  mapping: string;
}

/** The text of an email cell is stored for review, so cap it. A pasted novel in that cell stays out of the database. */
const RAW_VALUE_MAX = 500;

/**
 * Imports one CSV: parse and validate (the same code the browser uses for its preview, but here it is
 * the authority), create the contacts that do not exist yet, and record what happened to every row.
 *
 * Not atomic across the whole file (D1 batches are atomic, a file is many batches), so it is built to be
 * re-run: existing contacts are skipped, and a failure leaves the import marked Failed with the contacts
 * saved so far kept.
 */
export async function runCsvImport(db: Database, file: UploadedCsv, createdBy: string): Promise<ImportDto> {
  if (!/\.csv$/i.test(file.filename)) throw badRequest("Only .csv files are accepted", undefined, "INVALID_FILE");
  if (file.size === 0) throw badRequest("The file is empty", undefined, "INVALID_FILE");
  if (file.size > MAX_FILE_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);

  const parsed = parseCsvFile(file.text);
  if (!parsed.ok) throw new ApiError(422, "INVALID_CSV", parsed.error);

  let mappingJson: unknown;
  try {
    mappingJson = JSON.parse(file.mapping);
  } catch {
    throw badRequest("The column mapping must be valid JSON", undefined, "VALIDATION_ERROR");
  }
  const mapping = importMappingSchema.safeParse(mappingJson);
  if (!mapping.success) throw badRequest("Validation failed", formatIssues(mapping.error), "VALIDATION_ERROR");
  const outOfRange = Object.entries(mapping.data).filter(([, i]) => i !== undefined && i >= parsed.headers.length);
  if (outOfRange.length > 0) {
    throw badRequest(
      "Validation failed",
      outOfRange.map(([field]) => ({ path: field, message: `The file has only ${parsed.headers.length} columns` })),
      "VALIDATION_ERROR",
    );
  }

  const t0 = Date.now();
  const result = validateRows(parsed.rows, parsed.headers.length, mapping.data as Mapping);
  const tValidated = Date.now();
  const imports = importsRepo(db);
  const contacts = contactsRepo(db);

  const importId = await imports.start({
    filename: file.filename.slice(0, 255),
    fileSize: file.size,
    columnMapping: Object.fromEntries(Object.entries(mapping.data).filter(([, v]) => v !== undefined)) as Record<string, number>,
    totalRows: result.total,
    validRows: result.counts.valid,
    malformedRows: result.counts.malformed,
    badRows: result.counts.badRow,
    duplicateRows: result.counts.duplicate,
    blankRows: result.counts.blank,
    numericWarnings: result.numericWarnings,
    createdBy,
  });

  try {
    const created = await contacts.insertMany(result.valid, importId);
    const tContacts = Date.now();
    const ids = await contacts.idsByEmail(result.valid.map((c) => c.email));
    const tIds = Date.now();

    const rows: RowResult[] = [
      ...result.valid.map((c) => ({
        rowNumber: c.row,
        rawValue: c.rawEmail.slice(0, RAW_VALUE_MAX),
        outcome: created.has(c.email) ? ("Created" as const) : ("Existing" as const),
        contactId: ids.get(c.email) ?? null,
      })),
      ...result.invalid.map((r) => ({
        rowNumber: r.row,
        rawValue: r.raw.slice(0, RAW_VALUE_MAX),
        outcome: r.reason,
        contactId: null,
      })),
    ].sort((a, b) => a.rowNumber - b.rowNumber);

    await imports.addRows(importId, rows);
    await imports.complete(importId, created.size, result.valid.length - created.size);
    // Operational metadata only (no file content, no addresses). Phase timings show where a slow import spends its time.
    console.log(
      JSON.stringify({
        level: "info",
        event: "import_done",
        importId,
        rows: result.total,
        created: created.size,
        ms: { validate: tValidated - t0, contacts: tContacts - tValidated, lookup: tIds - tContacts, rows: Date.now() - tIds },
      }),
    );
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "import_failed", importId, error: err instanceof Error ? err.name : "unknown" }));
    // Best effort: if even this write fails, the import stays Processing, which is visible and recoverable.
    await imports.fail(importId, "The import could not be completed. Contacts saved before the failure were kept. Upload the file again to finish.").catch(() => undefined);
    throw new ApiError(500, "IMPORT_FAILED", "The import could not be completed. Upload the file again to finish.", { importId });
  }

  return imports.get(importId);
}
