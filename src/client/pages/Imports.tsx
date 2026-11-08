import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ImportDto } from "@shared/api";
import { Badge, Button, Card, CardHeader, Empty, ErrorNotice, LoadingRows, Notice, PageHeader, Pagination, Table, Td, Th, fmt, fmtDate } from "@/components/ui";
import { ColumnMapper, CsvDropzone, CsvFileBar, ValidationSummary } from "@/components/csv";
import { useCsvFile } from "@/hooks/useCsvFile";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { rejectedRowsUrl, useCreateImport, useImports } from "@/services/imports";

type Step = 0 | 1 | 2 | 3;
const STEPS = ["Upload", "Map columns", "Review", "Done"];
const PAGE_SIZE = 10;
const statusTone = { Completed: "green", Processing: "amber", Failed: "red" } as const;

export function Imports() {
  const { canEdit } = useRole();
  const { toast } = useToast();
  const csv = useCsvFile();
  const create = useCreateImport();
  const [step, setStep] = useState<Step>(0);
  const [done, setDone] = useState<ImportDto | null>(null);
  const [page, setPage] = useState(1);
  const history = useImports(page, PAGE_SIZE);

  // Move on as soon as a file has been read successfully.
  useEffect(() => {
    if (csv.status === "ready" && step === 0) setStep(1);
    if (csv.status !== "ready" && step !== 0 && step !== 3) setStep(0);
  }, [csv.status, step]);

  function reset() {
    csv.reset();
    create.reset();
    setDone(null);
    setStep(0);
  }

  async function confirm() {
    if (!csv.file) return;
    try {
      const imported = await create.mutateAsync({ file: csv.file, mapping: csv.mapping });
      setDone(imported);
      setStep(3);
      toast(`Imported ${fmt(imported.createdContacts)} new contacts`);
    } catch {
      /* the error is shown in the review step */
    }
  }

  const emailMapped = csv.mapping.email !== undefined;
  const error = create.error;
  // The server re-validates the file. If it ever disagrees with the preview, say so rather than hide it.
  const disagrees = done && csv.result && done.validRows !== csv.result.counts.valid;

  return (
    <>
      <PageHeader title="Imports" description="Upload a CSV, review the validation results, then confirm to save the contacts. Uses the template.csv columns." />

      {canEdit ? (
        <Card className="mb-6">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label="Import progress">
              {STEPS.map((s, i) => (
                <li key={s} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${i < step ? "bg-emerald-500 text-white" : i === step ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>
                    {i < step ? "✓" : i + 1}
                  </span>
                  <span className={i === step ? "font-medium" : "text-slate-500"}>{s}</span>
                  {i < STEPS.length - 1 && <span className="mx-1 text-slate-300">/</span>}
                </li>
              ))}
            </ol>
          </div>

          {step === 0 && <div className="p-5"><CsvDropzone csv={csv} /></div>}

          {step === 1 && (
            <div className="space-y-5 p-5">
              <CsvFileBar csv={csv} />
              <ColumnMapper csv={csv} />
              <div className="flex justify-between">
                <Button onClick={reset}>Back</Button>
                <Button variant="primary" disabled={!emailMapped} onClick={() => setStep(2)}>Validate rows</Button>
              </div>
            </div>
          )}

          {step === 2 && csv.result && (
            <div className="space-y-5 p-5">
              <CsvFileBar csv={csv} />
              <ValidationSummary result={csv.result} filename={csv.filename} />
              <Notice tone="info">
                Contacts are global: one row per email address. Addresses that already exist keep their current details and are not overwritten. The server checks the file again when you confirm.
              </Notice>
              {error && (
                <Notice tone="error" title="The import did not complete">
                  <p>{error instanceof ApiClientError ? error.message : "Something went wrong."}</p>
                  {error instanceof ApiClientError && error.fieldErrors.length > 0 && (
                    <ul className="mt-1 list-disc pl-5">{error.fieldErrors.map((f) => <li key={f.path}>{f.path}: {f.message}</li>)}</ul>
                  )}
                  {error instanceof ApiClientError && error.code === "IMPORT_FAILED" && <p className="mt-1">Contacts saved before the failure were kept. Uploading the same file again finishes the job without creating duplicates.</p>}
                  {error instanceof ApiClientError && error.correlationId && <p className="mt-1 text-xs opacity-80">Reference: {error.correlationId}</p>}
                </Notice>
              )}
              <div className="flex justify-between">
                <Button disabled={create.isPending} onClick={() => { create.reset(); setStep(1); }}>Back</Button>
                <Button variant="primary" disabled={csv.result.counts.valid === 0 || create.isPending} onClick={confirm}>
                  {create.isPending ? "Saving contacts…" : `Confirm and save ${fmt(csv.result.counts.valid)} contacts`}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && done && (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-xl text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" aria-hidden="true">✓</div>
              <p className="text-lg font-semibold">Import complete</p>
              <p className="mt-1 max-w-xl text-sm text-slate-500">
                {fmt(done.createdContacts)} new contact{done.createdContacts === 1 ? "" : "s"} saved from {done.filename}
                {done.existingContacts > 0 && <>. {fmt(done.existingContacts)} already existed and were left unchanged</>}
                {done.rejectedRows > 0 && <>. {fmt(done.rejectedRows)} row{done.rejectedRows === 1 ? " was" : "s were"} not imported</>}.
              </p>
              {disagrees && (
                <div className="mt-4 max-w-xl text-left"><Notice tone="warn">The server counted {fmt(done.validRows)} valid rows, but the preview showed {fmt(csv.result?.counts.valid ?? 0)}. The server's count is the one that was saved.</Notice></div>
              )}
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Link to="/contacts"><Button>View contacts</Button></Link>
                <Link to="/campaigns/new"><Button variant="primary">Create a campaign</Button></Link>
                {done.rejectedRows > 0 && <a href={rejectedRowsUrl(done.id)} download><Button type="button">Download rejected rows</Button></a>}
                <Button onClick={reset}>Import another file</Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <div className="mb-6"><Notice>Your role is read-only. Switch to Administrator or Campaign Manager (top right) to import.</Notice></div>
      )}

      <Card>
        <CardHeader title="Import history" />
        {history.isError ? (
          <div className="p-4"><ErrorNotice error={history.error} onRetry={() => void history.refetch()} /></div>
        ) : history.isPending ? (
          <LoadingRows cols={7} rows={3} />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>File</Th><Th>Uploaded</Th><Th className="text-right">Rows</Th><Th className="text-right">New contacts</Th><Th className="text-right">Already existed</Th><Th className="text-right">Rejected</Th><Th>Status</Th><Th><span className="sr-only">Report</span></Th></tr>
              </thead>
              <tbody>
                {history.data.items.map((i) => (
                  <tr key={i.id}>
                    <Td><span className="font-medium">{i.filename}</span><p className="text-xs text-slate-500">{i.createdBy}</p></Td>
                    <Td className="whitespace-nowrap text-slate-500">{fmtDate(i.createdAt)}</Td>
                    <Td className="text-right tabular-nums">{fmt(i.totalRows)}</Td>
                    <Td className="text-right tabular-nums">{fmt(i.createdContacts)}</Td>
                    <Td className="text-right tabular-nums">{fmt(i.existingContacts)}</Td>
                    <Td className="text-right tabular-nums">{fmt(i.rejectedRows)}</Td>
                    <Td><Badge tone={statusTone[i.status]}>{i.status}</Badge></Td>
                    <Td className="text-right">{i.rejectedRows > 0 && <a className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400" href={rejectedRowsUrl(i.id)} download>Rejected rows</a>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {history.data.items.length === 0 && <Empty>No imports yet.</Empty>}
            <Pagination page={page} pageCount={Math.max(1, Math.ceil(history.data.total / PAGE_SIZE))} total={history.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
