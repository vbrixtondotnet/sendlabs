import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { ImportDto, ImportRowDto, Page } from "../../../shared/api";
import type { ImportRowsQuery } from "../../../shared/schemas";
import type { InvalidRow } from "../../../shared/types";
import { badRequest, notFound } from "../../lib/errors";
import { toImportDto, toImportRowDto } from "../../lib/dto";
import { offsetOf, pageOf } from "../../lib/http";
import { newId, nowMs } from "../../lib/id";
import { REJECTED_OUTCOMES, type ImportRowOutcome } from "../../../shared/types";
import { chunk, runBulk } from "../batch";
import type { Database } from "../client";
import { importRows, imports } from "../schema";
import { usersRepo } from "./users";

export interface NewImport {
  filename: string;
  fileSize: number;
  columnMapping: Record<string, number>;
  totalRows: number;
  validRows: number;
  malformedRows: number;
  badRows: number;
  duplicateRows: number;
  blankRows: number;
  numericWarnings: number;
  /** The uploading user's id. */
  createdBy: string;
}

export interface RowResult {
  rowNumber: number;
  rawValue: string;
  outcome: ImportRowOutcome;
  contactId: string | null;
}

/** Scoped to `tenantId`: another tenant's imports do not exist as far as this repository is concerned. */
export function importsRepo(db: Database, tenantId: string) {
  const mine = eq(imports.tenantId, tenantId);
  const users = usersRepo(db, tenantId);

  const byId = async (id: string) => {
    const [row] = await db.select().from(imports).where(and(mine, eq(imports.id, id))).limit(1);
    return row ?? null;
  };

  return {
    /** Starts an import in the Processing state, so a crash mid-way leaves a visible record. */
    async start(input: NewImport): Promise<string> {
      const [row] = await db.insert(imports).values({ ...input, tenantId, status: "Processing" }).returning({ id: imports.id });
      if (!row) throw new Error("Insert returned no row");
      return row.id;
    },

    /** Writes every row's outcome, in bulk (see `runBulk`). */
    async addRows(importId: string, rows: readonly RowResult[]): Promise<void> {
      const now = nowMs();
      const sqlText = `INSERT INTO import_rows (id, tenant_id, import_id, row_number, raw_value, outcome, contact_id, created_at)
        SELECT json_extract(value,'$[0]'), ?4, ?2, json_extract(value,'$[1]'), json_extract(value,'$[2]'),
               json_extract(value,'$[3]'), json_extract(value,'$[4]'), ?3
        FROM json_each(?1) WHERE true`;
      const statements = chunk(rows, 200).map((group) =>
        db.$client.prepare(sqlText).bind(
          JSON.stringify(group.map((r) => [newId(), r.rowNumber, r.rawValue, r.outcome, r.contactId])),
          importId,
          now,
          tenantId,
        ),
      );
      await runBulk(db, statements);
    },

    async complete(id: string, createdContacts: number, existingContacts: number): Promise<void> {
      await db
        .update(imports)
        .set({ status: "Completed", createdContacts, existingContacts, completedAt: nowMs() })
        .where(and(mine, eq(imports.id, id)));
    },

    /** `error` must already be safe to show: no file content, no tokens. */
    async fail(id: string, error: string): Promise<void> {
      await db.update(imports).set({ status: "Failed", error, completedAt: nowMs() }).where(and(mine, eq(imports.id, id)));
    },

    async list(page: number, pageSize: number): Promise<Page<ImportDto>> {
      const [rows, totalRows] = await Promise.all([
        db.select().from(imports).where(mine).orderBy(desc(imports.createdAt), desc(imports.id)).limit(pageSize).offset(offsetOf(page, pageSize)),
        db.select({ n: count() }).from(imports).where(mine),
      ]);
      const emails = await users.emails(rows.map((r) => r.createdBy));
      return pageOf(rows.map((r) => toImportDto(r, emails.get(r.createdBy) ?? "")), totalRows[0]?.n ?? 0, page, pageSize);
    },

    async get(id: string): Promise<ImportDto> {
      const row = await byId(id);
      if (!row) throw notFound("Import");
      const emails = await users.emails([row.createdBy]);
      return toImportDto(row, emails.get(row.createdBy) ?? "");
    },

    /** A campaign may only target one of THIS tenant's imports, and only one that finished. */
    async assertUsable(id: string): Promise<void> {
      const row = await byId(id);
      if (!row || row.status !== "Completed") {
        throw badRequest(
          "Validation failed",
          [{ path: "recipientImportId", message: "That import does not exist or did not complete" }],
          "VALIDATION_ERROR",
        );
      }
    },

    async listRows(importId: string, q: ImportRowsQuery): Promise<Page<ImportRowDto>> {
      if (!(await byId(importId))) throw notFound("Import");
      const conditions: (SQL | undefined)[] = [eq(importRows.tenantId, tenantId), eq(importRows.importId, importId)];
      if (q.outcome) conditions.push(eq(importRows.outcome, q.outcome));
      else if (q.show === "rejected") conditions.push(inArray(importRows.outcome, [...REJECTED_OUTCOMES]));
      const where = and(...conditions);
      const [rows, totalRows] = await Promise.all([
        db.select().from(importRows).where(where).orderBy(importRows.rowNumber).limit(q.pageSize).offset(offsetOf(q.page, q.pageSize)),
        db.select({ n: count() }).from(importRows).where(where),
      ]);
      return pageOf(rows.map(toImportRowDto), totalRows[0]?.n ?? 0, q.page, q.pageSize);
    },

    /** Every rejected row, for the downloadable report. Bounded by the import row limit. */
    async rejectedRows(importId: string): Promise<InvalidRow[]> {
      if (!(await byId(importId))) throw notFound("Import");
      const rows = await db
        .select()
        .from(importRows)
        .where(and(eq(importRows.tenantId, tenantId), eq(importRows.importId, importId), inArray(importRows.outcome, [...REJECTED_OUTCOMES])))
        .orderBy(importRows.rowNumber);
      // The query only returns rejected outcomes, which are exactly the InvalidRow reasons.
      return rows.map((r) => ({ row: r.rowNumber, raw: r.rawValue, reason: r.outcome as InvalidRow["reason"] }));
    },
  };
}
