import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { IMPORT_ROW_OUTCOMES, IMPORT_STATUSES } from "../../../shared/types";
import { contacts } from "./contacts";
import { createdAt, idColumn, inList } from "./helpers";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * One CSV upload by one of a tenant's users. The server parses the file in the same request, so the
 * original is not stored. Counts are authoritative (computed by the Worker, not the browser).
 */
export const imports = sqliteTable(
  "imports",
  {
    id: idColumn(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
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
    /** The uploading user. The composite key below guarantees they belong to the same tenant. */
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    completedAt: integer("completed_at"),
  },
  (t) => [
    // Lets import rows reference "an import of the SAME tenant" with a composite foreign key.
    uniqueIndex("imports_tenant_id_uq").on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [users.tenantId, users.id], name: "imports_creator_fk" }),
    index("imports_tenant_created_at_idx").on(t.tenantId, t.createdAt),
    check("imports_status_chk", inList("status", IMPORT_STATUSES)),
    check("imports_counts_chk", sql.raw(
      `"total_rows" >= 0 AND "valid_rows" >= 0 AND "created_contacts" >= 0 AND "existing_contacts" >= 0 AND "valid_rows" <= "total_rows"`,
    )),
  ],
);

/**
 * The result for every row of an import. This is what makes an import reusable: the rows that
 * link to a contact are exactly the recipients of "this import", including contacts that already
 * existed before the file was uploaded. Carries its own `tenant_id`, and the composite keys guarantee the
 * import and the contact belong to that same tenant.
 */
export const importRows = sqliteTable(
  "import_rows",
  {
    id: idColumn(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    importId: text("import_id").notNull(),
    /** Spreadsheet-style: the header is row 1, the first data row is row 2. */
    rowNumber: integer("row_number").notNull(),
    /** The text of the email cell, trimmed and cut to 500 characters. */
    rawValue: text("raw_value").notNull().default(""),
    outcome: text("outcome", { enum: IMPORT_ROW_OUTCOMES }).notNull(),
    /**
     * Set for Created and Existing rows. Erasing a contact first sets this to NULL (see contactsRepo.delete),
     * so import history survives. A composite key cannot use SET NULL because it would also null tenant_id.
     */
    contactId: text("contact_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.importId], foreignColumns: [imports.tenantId, imports.id], name: "import_rows_import_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.contactId], foreignColumns: [contacts.tenantId, contacts.id], name: "import_rows_contact_fk" }),
    uniqueIndex("import_rows_import_row_uq").on(t.importId, t.rowNumber),
    index("import_rows_import_outcome_idx").on(t.importId, t.outcome),
    index("import_rows_contact_idx").on(t.tenantId, t.contactId),
    check("import_rows_outcome_chk", inList("outcome", IMPORT_ROW_OUTCOMES)),
    // Linked rows have a contact (until it is erased). Rejected rows never do.
    check("import_rows_rejected_unlinked_chk", sql.raw(
      `"outcome" IN ('Created', 'Existing') OR "contact_id" IS NULL`,
    )),
  ],
);

export type ImportRow = typeof imports.$inferSelect;
export type ImportRowRow = typeof importRows.$inferSelect;
