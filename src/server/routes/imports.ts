import { Hono } from "hono";
import type { AppEnv } from "../app";
import { importsRepo } from "../database/repositories/imports";
import { badRequest } from "../lib/errors";
import { parseQuery } from "../lib/http";
import { runCsvImport } from "../services/csv-import";
import { importListQuery, importRowsQuery } from "../../shared/schemas";
import { invalidReportRows, toCsv } from "../../shared/csv";

export const importRoutes = new Hono<AppEnv>();

/**
 * multipart/form-data with two fields:
 *   file     the .csv
 *   mapping  JSON, { fieldKey: csvColumnIndex }, e.g. {"email":4,"firstName":0}
 */
importRoutes.post("/", async (c) => {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    throw badRequest("Send the file as multipart/form-data with fields `file` and `mapping`", undefined, "INVALID_UPLOAD");
  }
  let form: Record<string, string | File>;
  try {
    form = await c.req.parseBody();
  } catch {
    throw badRequest("The upload could not be read", undefined, "INVALID_UPLOAD");
  }
  const file = form["file"];
  const mapping = form["mapping"];
  if (typeof file === "string" || file === undefined) throw badRequest("Missing the `file` field", undefined, "INVALID_UPLOAD");
  if (typeof mapping !== "string") throw badRequest("Missing the `mapping` field", undefined, "INVALID_UPLOAD");

  const { tenantId, userId } = c.get("actor");
  const dto = await runCsvImport(c.get("db"), { tenantId, userId }, { filename: file.name, size: file.size, text: await file.text(), mapping });
  return c.json(dto, 201);
});

importRoutes.get("/", async (c) => {
  const q = parseQuery(c, importListQuery);
  return c.json(await importsRepo(c.get("db"), c.get("actor").tenantId).list(q.page, q.pageSize));
});

importRoutes.get("/:id", async (c) => c.json(await importsRepo(c.get("db"), c.get("actor").tenantId).get(c.req.param("id"))));

importRoutes.get("/:id/rows", async (c) => {
  const q = parseQuery(c, importRowsQuery);
  return c.json(await importsRepo(c.get("db"), c.get("actor").tenantId).listRows(c.req.param("id"), q));
});

/** The downloadable report of rows that were not imported. Formula-injection safe. */
importRoutes.get("/:id/rejected-rows.csv", async (c) => {
  const repo = importsRepo(c.get("db"), c.get("actor").tenantId);
  const [meta, rows] = await Promise.all([repo.get(c.req.param("id")), repo.rejectedRows(c.req.param("id"))]);
  const base = meta.filename.replace(/\.csv$/i, "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "import";
  return c.body("﻿" + toCsv(invalidReportRows(rows)), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${base}-rejected-rows.csv"`,
    "Cache-Control": "no-store",
  });
});
