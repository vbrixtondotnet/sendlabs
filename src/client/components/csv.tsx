import { useRef, useState } from "react";
import type { CsvFile } from "@/hooks/useCsvFile";
import { downloadCsv, FIELDS, invalidReportRows, MAX_FILE_BYTES, MAX_ROWS, type FieldKey, type ValidationResult } from "@/lib/csv";
import { usePaged } from "@/hooks/usePaged";
import { Badge, Button, Notice, Pagination, StatCard, Table, Td, Th, fmt } from "@/components/ui";

/* ------------------------------ Dropzone ------------------------------ */

export function CsvDropzone({ csv, compact = false }: { csv: CsvFile; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const loading = csv.status === "loading";

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) void csv.load(f);
        }}
        className={`flex flex-col items-center rounded-xl border-2 border-dashed text-center transition ${compact ? "px-4 py-7" : "px-6 py-12"} ${drag ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-slate-300 dark:border-slate-700"}`}
      >
        <svg viewBox="0 0 24 24" className="mb-2 h-9 w-9 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v4h16v-4" /></svg>
        <p className="font-medium">{loading ? "Reading file…" : "Drop a .csv file here, or choose one"}</p>
        <p className="mt-1 max-w-lg text-sm text-slate-500 dark:text-slate-400">
          UTF-8 CSV with column names in the first row. An <strong>Email</strong> column is required. Up to {MAX_FILE_BYTES / 1024 / 1024} MB and {fmt(MAX_ROWS)} rows. The file is read in your browser.
        </p>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="CSV file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void csv.load(f);
            e.target.value = "";
          }}
        />
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" disabled={loading} onClick={() => input.current?.click()}>Select CSV file</Button>
          <a href="/template.csv" download="template.csv"><Button type="button">Download template.csv</Button></a>
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
          <button className="text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400" disabled={loading} onClick={() => void csv.loadSample("/template.csv", "template.csv")}>Try the sample (25 contacts)</button>
          <button className="text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400" disabled={loading} onClick={() => void csv.loadSample("/sample-with-errors.csv", "sample-with-errors.csv")}>Try a sample with bad rows</button>
        </div>
      </div>
      {csv.status === "error" && (
        <div className="mt-3"><Notice tone="error" title={csv.filename ? `Could not use ${csv.filename}` : "Could not use that file"}>{csv.error}</Notice></div>
      )}
    </div>
  );
}

/* ----------------------------- File summary ----------------------------- */

export function CsvFileBar({ csv }: { csv: CsvFile }) {
  const kb = csv.size / 1024;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-2.5 text-sm dark:bg-slate-800/50">
      <p>
        <span className="font-medium">{csv.filename}</span>
        <span className="text-slate-500"> · {kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`} · {fmt(csv.rows.length)} data rows · {csv.headers.length} columns</span>
      </p>
      <Button variant="ghost" onClick={csv.reset}>Choose a different file</Button>
    </div>
  );
}

/* ------------------------------ Column mapper ------------------------------ */

export function ColumnMapper({ csv }: { csv: CsvFile }) {
  const NONE = "";
  const usedTwice = new Set<number>();
  const seen = new Set<number>();
  for (const f of FIELDS) {
    const i = csv.mapping[f.key];
    if (i === undefined) continue;
    if (seen.has(i)) usedTwice.add(i);
    seen.add(i);
  }
  const set = (key: FieldKey, value: string) => {
    const next = { ...csv.mapping };
    if (value === NONE) delete next[key];
    else next[key] = Number(value);
    csv.setMapping(next);
  };
  const emailIdx = csv.mapping.email;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => {
          const idx = csv.mapping[f.key];
          return (
            <div key={f.key}>
              <label htmlFor={`map-${f.key}`} className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                {f.label}
                {f.required && <span className="text-xs font-normal text-rose-600">required</span>}
              </label>
              <select
                id={`map-${f.key}`}
                value={idx === undefined ? NONE : String(idx)}
                onChange={(e) => set(f.key, e.target.value)}
                className={`w-full rounded-lg border bg-white px-3 py-2 text-sm dark:bg-slate-900 ${f.required && idx === undefined ? "border-rose-400" : "border-slate-300 dark:border-slate-700"}`}
              >
                <option value={NONE}>{f.required ? "Select a column" : "Not mapped"}</option>
                {csv.headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
              </select>
            </div>
          );
        })}
      </div>
      {usedTwice.size > 0 && <Notice tone="warn">The same CSV column is mapped to more than one field.</Notice>}
      {emailIdx === undefined && <Notice tone="error">Choose which column holds the email address.</Notice>}

      <div>
        <p className="mb-2 text-sm font-medium">Preview (first {Math.min(5, csv.rows.length)} of {fmt(csv.rows.length)} rows)</p>
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <Table>
            <thead>
              <tr>
                {csv.headers.map((h, i) => (
                  <Th key={i}>
                    {h || `(column ${i + 1})`}
                    {i === emailIdx && <span className="ml-1.5 normal-case"><Badge tone="indigo">email</Badge></span>}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csv.rows.slice(0, 5).map((r, ri) => (
                <tr key={ri}>
                  {csv.headers.map((_, ci) => (
                    <Td key={ci} className="max-w-[16rem] truncate text-slate-600 dark:text-slate-300">{r[ci] || <span className="text-slate-300 dark:text-slate-600">(blank)</span>}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Validation summary --------------------------- */

const reasonTone = { Malformed: "red", "Bad row": "red", Blank: "amber", Duplicate: "amber" } as const;

export function ValidationSummary({ result, filename, compact = false }: { result: ValidationResult; filename: string; compact?: boolean }) {
  const { counts, invalid } = result;
  const paged = usePaged(invalid, compact ? 5 : 10);
  const reportName = filename.replace(/\.csv$/i, "") + "-invalid-rows.csv";

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-2 gap-3 ${compact ? "sm:grid-cols-5" : "sm:grid-cols-5"}`}>
        <StatCard label="Total rows" value={fmt(result.total)} />
        <StatCard label="Valid" value={fmt(counts.valid)} tone="good" />
        <StatCard label="Invalid" value={fmt(counts.malformed + counts.badRow)} tone={counts.malformed + counts.badRow ? "bad" : "default"} hint={counts.badRow ? `${counts.badRow} with extra columns` : undefined} />
        <StatCard label="Duplicate" value={fmt(counts.duplicate)} tone={counts.duplicate ? "warn" : "default"} hint="Later copies skipped" />
        <StatCard label="Blank email" value={fmt(counts.blank)} tone={counts.blank ? "warn" : "default"} />
      </div>

      {result.numericWarnings > 0 && (
        <Notice tone="warn">
          {fmt(result.numericWarnings)} row{result.numericWarnings === 1 ? "" : "s"} had a non-numeric # Employees or Annual Revenue. Those contacts are kept and the value is left blank.
        </Notice>
      )}
      {invalid.length === 0 ? (
        <Notice tone="good">Every row has a valid, unique email address. Syntax checks cannot prove a mailbox exists.</Notice>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div>
              <p className="text-sm font-semibold">Rows that will not be imported ({fmt(invalid.length)})</p>
              <p className="text-xs text-slate-500">Nothing is discarded silently. Download the list to fix and re-upload. Row 1 is the header.</p>
            </div>
            <Button onClick={() => downloadCsv(reportName, invalidReportRows(invalid))}>Download report</Button>
          </div>
          <Table>
            <thead><tr><Th>Row</Th><Th>Email value</Th><Th>Reason</Th></tr></thead>
            <tbody>
              {paged.slice.map((r) => (
                <tr key={r.row}>
                  <Td className="tabular-nums">{r.row}</Td>
                  <Td className="font-mono text-xs">{r.raw.trim() === "" ? <span className="text-slate-400">(empty)</span> : r.raw}</Td>
                  <Td><Badge tone={reasonTone[r.reason]}>{r.reason}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {paged.pageCount > 1 && <Pagination page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={paged.pageSize} onPage={paged.setPage} />}
        </div>
      )}
    </div>
  );
}
