import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { JobCompanyDto, JobDto, Page } from "@shared/api";
import { api, withQuery } from "./http";

export interface JobFilters {
  keyword: string;
  categories: string[];
  locations: string[];
}

/** One page of jobs. The server filters and pages: only the requested page is fetched. Lists are sent comma-separated. */
export function useJobs(filters: JobFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: ["jobs", filters, page, pageSize],
    queryFn: () =>
      api<Page<JobDto>>(
        "GET",
        withQuery("/api/jobs", { page, pageSize, keyword: filters.keyword.trim(), categories: filters.categories.join(","), locations: filters.locations.join(",") }),
      ),
    placeholderData: keepPreviousData,
  });
}

/** The choices of the Category filter. */
export function useJobCategories() {
  return useQuery({ queryKey: ["jobs", "categories"], queryFn: () => api<{ items: string[] }>("GET", "/api/jobs/categories"), staleTime: 5 * 60_000 });
}

/** The choices of the Location filter. */
export function useJobLocations() {
  return useQuery({ queryKey: ["jobs", "locations"], queryFn: () => api<{ items: string[] }>("GET", "/api/jobs/locations"), staleTime: 5 * 60_000 });
}

/** The companies with jobs listed (the Hiring Companies panel). */
export function useJobCompanies() {
  return useQuery({ queryKey: ["jobs", "companies"], queryFn: () => api<{ items: JobCompanyDto[] }>("GET", "/api/jobs/companies"), staleTime: 5 * 60_000 });
}
