import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AddContactResultDto, MeDto, PeopleSearchDto } from "@shared/api";
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

/**
 * "Add Contact": adds the person to the user's contacts, reveals their email address and spends 1 credit. Afterwards the
 * search results (which now show the address), the contacts list and the credit balance (inside /api/me) are refreshed.
 */
export function useAddPersonContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (personId: string) => api<AddContactResultDto>("POST", `/api/people/${encodeURIComponent(personId)}/add-contact`),
    onSuccess: (result) => {
      qc.setQueryData<MeDto>(["me"], (me) => (me ? { ...me, user: { ...me.user, credits: result.credits } } : me));
      void qc.invalidateQueries({ queryKey: ["people"] });
      void qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
