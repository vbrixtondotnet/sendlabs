import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { IMPORT_ROW_OUTCOMES, IMPORT_STATUSES } from "../../../shared/types";
import { contacts } from "./contacts";
import { createdAt, idColumn, inList } from "./helpers";
import { users } from "./users";

/**
 * One CSV upload by an account. The server parses the file in the same request, so the
 * original is not stored. Counts are authoritative (computed by the Worker, not the browser).
 */
export const imports = pgTable(
  "imports",
  {
    id: idColumn(),
    /** The account that owns this row. Every query filters by it; the composite keys below stop a row pointing at another account's data. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    filename: text("filename").notNull(),
    fileSize: integer("file_size").notNull(),
    status: text("status", { enum: IMPORT_STATUSES }).notNull().default("Processing"),
    /** { fieldKey: csvColumnIndex }, as the user confirmed it. */
    columnMapping: jsonb("column_mapping").$type<Record<string, number>>().notNull(),

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
    createdAt: createdAt(),
    completedAt: bigint("completed_at", { mode: "number" }),
  },
  (t) => [
    // Lets import rows reference "an import of the SAME account" with a composite foreign key.
    uniqueIndex("imports_user_id_uq").on(t.userId, t.id),
    index("imports_user_created_at_idx").on(t.userId, t.createdAt),
    check("imports_status_chk", inList("status", IMPORT_STATUSES)),
    check("imports_counts_chk", sql.raw(
      `"total_rows" >= 0 AND "valid_rows" >= 0 AND "created_contacts" >= 0 AND "existing_contacts" >= 0 AND "valid_rows" <= "total_rows"`,
    )),
  ],
);

/**
 * The result for every row of an import. This is what makes an import reusable: the rows that
 * link to a contact are exactly the recipients of "this import", including contacts that already
 * existed before the file was uploaded. Carries its own `user_id`, and the composite keys guarantee the
 * import and the contact belong to that same account.
 */
export const importRows = pgTable(
  "import_rows",
  {
    id: idColumn(),
    /** The account that owns this row. Every query filters by it; the composite keys below stop a row pointing at another account's data. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    importId: text("import_id").notNull(),
    /** Spreadsheet-style: the header is row 1, the first data row is row 2. */
    rowNumber: integer("row_number").notNull(),
    /** The text of the email cell, trimmed and cut to 500 characters. */
    rawValue: text("raw_value").notNull().default(""),
    outcome: text("outcome", { enum: IMPORT_ROW_OUTCOMES }).notNull(),
    /**
     * Set for Created and Existing rows. Erasing a contact first sets this to NULL (see contactsRepo.delete),
     * so import history survives. A composite key cannot use SET NULL because it would also null user_id.
     */
    contactId: text("contact_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.userId, t.importId], foreignColumns: [imports.userId, imports.id], name: "import_rows_import_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.userId, t.contactId], foreignColumns: [contacts.userId, contacts.id], name: "import_rows_contact_fk" }),
    uniqueIndex("import_rows_import_row_uq").on(t.importId, t.rowNumber),
    index("import_rows_import_outcome_idx").on(t.importId, t.outcome),
    index("import_rows_contact_idx").on(t.userId, t.contactId),
    check("import_rows_outcome_chk", inList("outcome", IMPORT_ROW_OUTCOMES)),
    // Linked rows have a contact (until it is erased). Rejected rows never do.
    check("import_rows_rejected_unlinked_chk", sql.raw(
      `"outcome" IN ('Created', 'Existing') OR "contact_id" IS NULL`,
    )),
  ],
);

export type ImportRow = typeof imports.$inferSelect;
export type ImportRowRow = typeof importRows.$inferSelect;
