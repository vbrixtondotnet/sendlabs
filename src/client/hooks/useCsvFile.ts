import { useCallback, useMemo, useState } from "react";
import { autoMap, MAX_FILE_BYTES, parseCsvFile, validateRows, type Mapping, type ValidationResult } from "@/lib/csv";

export type CsvStatus = "idle" | "loading" | "ready" | "error";

interface Loaded {
  status: CsvStatus;
  filename: string;
  size: number;
  /** The original file, kept so it can be uploaded after the user has reviewed it. */
  file: File | null;
  headers: string[];
  rows: string[][];
  error: string | null;
}

const EMPTY: Loaded = { status: "idle", filename: "", size: 0, file: null, headers: [], rows: [], error: null };

/**
 * Reads and validates a CSV in the browser for the live preview. Nothing is uploaded here: the server
 * parses the file again when it is imported, and its counts are the ones that count.
 */
export function useCsvFile() {
  const [data, setData] = useState<Loaded>(EMPTY);
  const [mapping, setMapping] = useState<Mapping>({});

  const fail = (error: string, filename = "") => setData({ ...EMPTY, status: "error", filename, error });

  const accept = useCallback((file: File, text: string) => {
    const parsed = parseCsvFile(text);
    if (!parsed.ok) return fail(parsed.error, file.name);
    setMapping(autoMap(parsed.headers));
    setData({ status: "ready", filename: file.name, size: file.size, file, headers: parsed.headers, rows: parsed.rows, error: null });
  }, []);

  const load = useCallback(
    async (file: File) => {
      if (!/\.csv$/i.test(file.name)) return fail("Only .csv files are accepted.", file.name);
      if (file.size === 0) return fail("The file is empty.", file.name);
      if (file.size > MAX_FILE_BYTES) return fail(`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`, file.name);
      setData({ ...EMPTY, status: "loading", filename: file.name, size: file.size });
      try {
        accept(file, await file.text());
      } catch {
        fail("The file could not be read.", file.name);
      }
    },
    [accept],
  );

  /** Loads a bundled static sample from /public (not an API call). */
  const loadSample = useCallback(
    async (path: string, filename: string) => {
      setData({ ...EMPTY, status: "loading", filename });
      try {
        const text = await (await fetch(path)).text();
        accept(new File([text], filename, { type: "text/csv" }), text);
      } catch {
        fail("The sample file could not be loaded.", filename);
      }
    },
    [accept],
  );

  const reset = useCallback(() => {
    setData(EMPTY);
    setMapping({});
  }, []);

  const result: ValidationResult | null = useMemo(
    () => (data.status === "ready" ? validateRows(data.rows, data.headers.length, mapping) : null),
    [data, mapping],
  );

  return { ...data, mapping, setMapping, result, load, loadSample, reset };
}

export type CsvFile = ReturnType<typeof useCsvFile>;
