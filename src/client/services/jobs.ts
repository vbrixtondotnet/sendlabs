import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { JobCategoryDto, JobDescriptionDto, JobsPageDto } from "@shared/api";
import type { JobSort } from "@shared/schemas";
import { api, withQuery } from "./http";

export interface JobFilters {
  keyword: string;
  /** Remotive's category value, or "" for all. */
  category: string;
  locations: string[];
  remoteOnly: boolean;
  sort: JobSort;
}

/**
 * One page of live jobs, from Remotive, Arbeitnow and Jobicy merged. Our server asks them (the browser never does), filters, sorts and pages them. React Query hands the
 * request an abort signal, so a search that has already been replaced is cancelled instead of finished.
 */
export function useJobs(filters: JobFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: ["jobs", filters, page, pageSize],
    queryFn: ({ signal }) =>
      api<JobsPageDto>(
        "GET",
        withQuery("/api/jobs", {
          page,
          pageSize,
          keyword: filters.keyword,
          category: filters.category,
          locations: filters.locations.join(","),
          remoteOnly: filters.remoteOnly ? "true" : undefined,
          sort: filters.sort,
        }),
        undefined,
        signal,
      ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false, // a failure is shown with a Try again button; retrying by itself would only hit Remotive more
  });
}

/** The choices of the Category filter (Remotive's own list). */
export function useJobCategories() {
  return useQuery({
    queryKey: ["jobs", "categories"],
    queryFn: ({ signal }) => api<{ items: JobCategoryDto[] }>("GET", "/api/jobs/categories", undefined, signal),
    staleTime: 60 * 60_000,
    retry: false,
  });
}

/** The choices of the Location filter: the places named by the current jobs. */
export function useJobLocations() {
  return useQuery({
    queryKey: ["jobs", "locations"],
    queryFn: ({ signal }) => api<{ items: string[] }>("GET", "/api/jobs/locations", undefined, signal),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** The words of an application email, and the files that go with it. */
export interface ApplicationEmailInput {
  to: string;
  subject: string;
  body: string;
  attachments: File[];
}

/** Sends an application email from the Apply panel: one recipient, no CC or BCC, as multipart form data (the files travel as they are). */
export function useSendApplicationEmail() {
  return useMutation({
    mutationFn: (input: ApplicationEmailInput) => {
      const form = new FormData();
      form.append("to", input.to);
      form.append("subject", input.subject);
      form.append("body", input.body);
      for (const f of input.attachments) form.append("attachments", f, f.name);
      return api<{ sent: boolean; attachments: number }>("POST", "/api/jobs/apply-email", form);
    },
  });
}

/** The description of one job, loaded when its View Job panel opens (the list does not carry descriptions: there are hundreds of them). */
export function useJobDescription(id: string) {
  return useQuery({
    queryKey: ["jobs", "description", id],
    queryFn: ({ signal }) => api<JobDescriptionDto>("GET", withQuery("/api/jobs/description", { id }), undefined, signal),
    staleTime: 10 * 60_000,
    retry: false,
  });
}
