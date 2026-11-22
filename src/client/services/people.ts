import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PeopleSearchDto } from "@shared/api";
import { api, withQuery } from "./http";

export interface PeopleFilters {
  countries: string[];
  industry: string;
  companySize: string;
  titles: string[];
}

/** Searches people (sample data until Apollo is connected). Lists are sent comma-separated. */
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
          industry: filters.industry,
          companySize: filters.companySize,
          titles: filters.titles.join(","),
        }),
      ),
    placeholderData: keepPreviousData,
  });
}
