import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportDto, Page } from "@shared/api";
import type { Mapping } from "@shared/csv";
import { api, withQuery } from "./http";

const keys = { all: ["imports"] as const, list: (page: number, pageSize: number) => ["imports", "list", page, pageSize] as const };

export function useImports(page = 1, pageSize = 25) {
  return useQuery({
    queryKey: keys.list(page, pageSize),
    queryFn: () => api<Page<ImportDto>>("GET", withQuery("/api/imports", { page, pageSize })),
    placeholderData: keepPreviousData,
  });
}

/** Where a rejected-rows report can be downloaded. The server builds it, so it is always complete. */
export const rejectedRowsUrl = (importId: string) => `/api/imports/${importId}/rejected-rows.csv`;

/**
 * Uploads the file with the user's column mapping. The server parses and validates it again and answers with
 * the authoritative counts. Contacts and campaigns change as a result, so both lists are refreshed.
 */
export function useCreateImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, mapping }: { file: File; mapping: Mapping }) => {
      const form = new FormData();
      form.set("file", file, file.name);
      form.set("mapping", JSON.stringify(mapping));
      return api<ImportDto>("POST", "/api/imports", form);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.all });
      void qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
