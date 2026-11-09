import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Page, SuppressionDto } from "@shared/api";
import { api, withQuery } from "./http";

/** The addresses that unsubscribed. Administrators only (the API answers 403 otherwise). */
export function useSuppressions(page = 1, pageSize = 25) {
  return useQuery({
    queryKey: ["suppressions", page, pageSize],
    queryFn: () => api<Page<SuppressionDto>>("GET", withQuery("/api/suppressions", { page, pageSize })),
    placeholderData: keepPreviousData,
  });
}
