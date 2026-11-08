import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { IMPORT_ROW_OUTCOMES, IMPORT_STATUSES } from "../../../shared/types";
import { contacts } from "./contacts";
import { createdAt, idColumn, inList } from "./helpers";

/**
 * One CSV upload. The server parses the file in the same request, so the original is not stored.
 * Counts are authoritative (computed by the Worker, not the browser).
 */
export const imports = sqliteTable(
  "imports",
  {
    id: idColumn(),
    filename: text("filename").notNull(),
    fileSize: integer("file_size").notNull(),
    status: text("status", { enum: IMPORT_STATUSES }).notNull().default("Processing"),
    /** { fieldKey: csvColumnIndex }, as the user confirmed it. */
    columnMapping: text("column_mapping", { mode: "json" }).$type<Record<string, number>>().notNull(),

    totalRows: integer("total_rows").notNull(),
    validRows: integer("valid_rows").notNull().default(0),
    createdContacts: integer("created_contacts").notNull().default(0),
    existingContacts: integer("existing_contacts").notNull().default(0),
    malformedRows: integer("malformed_rows").notNull().default(0),
    badRows: integer("bad_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    blankRows: integer("blank_rows").notNull().default(0),
    /** Rows kept, with a non-numeric # Employees / Annual Revenue left blank. */
    numericWarnings: integer("numeric_warnings").notNull().default(0),

    /** Sanitized failure reason. Never contains file content. */
    error: text("error"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    completedAt: integer("completed_at"),
  },
  (t) => [
    index("imports_created_at_idx").on(t.createdAt),
    check("imports_status_chk", inList("status", IMPORT_STATUSES)),
    check("imports_counts_chk", sql.raw(
      `"total_rows" >= 0 AND "valid_rows" >= 0 AND "created_contacts" >= 0 AND "existing_contacts" >= 0 AND "valid_rows" <= "total_rows"`,
    )),
  ],
);

/**
 * The result for every row of an import. This is what makes an import reusable: the rows that
 * link to a contact are exactly the recipients of "this import", including contacts that already
 * existed before the file was uploaded.
 */
export const importRows = sqliteTable(
  "import_rows",
  {
    id: idColumn(),
    importId: text("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    /** Spreadsheet-style: the header is row 1, the first data row is row 2. */
    rowNumber: integer("row_number").notNull(),
    /** The text of the email cell, trimmed and cut to 500 characters. */
    rawValue: text("raw_value").notNull().default(""),
    outcome: text("outcome", { enum: IMPORT_ROW_OUTCOMES }).notNull(),
    /** Set for Created and Existing rows. SET NULL so erasing a contact does not break import history. */
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("import_rows_import_row_uq").on(t.importId, t.rowNumber),
    index("import_rows_import_outcome_idx").on(t.importId, t.outcome),
    index("import_rows_contact_idx").on(t.contactId),
    check("import_rows_outcome_chk", inList("outcome", IMPORT_ROW_OUTCOMES)),
    // Linked rows have a contact (until it is erased). Rejected rows never do.
    check("import_rows_rejected_unlinked_chk", sql.raw(
      `"outcome" IN ('Created', 'Existing') OR "contact_id" IS NULL`,
    )),
  ],
);

export type ImportRow = typeof imports.$inferSelect;
export type ImportRowRow = typeof importRows.$inferSelect;
