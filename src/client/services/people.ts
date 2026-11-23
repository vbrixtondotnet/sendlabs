import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PeopleSearchDto } from "@shared/api";
import { api, withQuery } from "./http";

export interface PeopleFilters {
  countries: string[];
  industries: string[];
  companySize: string;
  titles: string[];
}

/** Searches the shared people directory. The server pages: only the requested page is fetched. Lists are sent comma-separated. */
export function usePeopleSearch(filters: PeopleFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: ["people", filters, page, pageSize],
    queryFn: () =>
      api<PeopleSearchDto>(
        "GET",
        withQuery("/api/people", {
          page,
          pageSize,
          countries: filters.countries.join(","),
          industries: filters.industries.join(","),
          companySize: filters.companySize,
          titles: filters.titles.join(","),
        }),
      ),
    placeholderData: keepPreviousData,
  });
}

/** The industries that exist in the directory (the choices of the Industry filter). */
export function usePeopleIndustries() {
  return useQuery({
    queryKey: ["people", "industries"],
    queryFn: () => api<{ items: string[] }>("GET", "/api/people/industries"),
    staleTime: 5 * 60_000,
  });
}
