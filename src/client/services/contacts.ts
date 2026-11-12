import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContactDto, Page } from "@shared/api";
import type { ConsentStatus } from "@shared/types";
import type { ContactCreate, ContactPatch } from "@shared/schemas";
import { api, withQuery } from "./http";

export interface ContactFilters {
  page: number;
  pageSize: number;
  q?: string;
  industry?: string;
  consent?: ConsentStatus | "";
}

const keys = {
  all: ["contacts"] as const,
  list: (f: ContactFilters) => ["contacts", "list", f] as const,
  industries: ["contacts", "industries"] as const,
};

export function useContacts(filters: ContactFilters) {
  return useQuery({
    queryKey: keys.list(filters),
    queryFn: () => api<Page<ContactDto>>("GET", withQuery("/api/contacts", { ...filters })),
    placeholderData: keepPreviousData,
  });
}

export function useIndustries() {
  return useQuery({
    queryKey: keys.industries,
    queryFn: async () => (await api<{ items: string[] }>("GET", "/api/contacts/industries")).items,
    staleTime: 60_000,
  });
}

/** Distinct industries with how many contacts each has. */
export function useIndustryCounts() {
  return useQuery({
    queryKey: [...keys.industries, "counts"] as const,
    queryFn: async () => {
      const r = await api<{ items: string[]; counts?: Record<string, number> }>("GET", "/api/contacts/industries");
      return r.items.map((industry) => ({ industry, count: r.counts?.[industry] ?? 0 }));
    },
    staleTime: 60_000,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ContactCreate> & { email: string }) => api<ContactDto>("POST", "/api/contacts", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ContactPatch }) => api<ContactDto>("PATCH", `/api/contacts/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}
