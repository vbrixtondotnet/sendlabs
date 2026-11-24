import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GlobalContactDto, Page } from "@shared/api";
import { api, withQuery } from "./http";

export type GlobalContactInput = Omit<GlobalContactDto, "id" | "updatedAt">;
const KEY = ["global-contacts"] as const;

/** The shared people directory, for a SuperAdmin to manage. The server pages and searches. */
export function useGlobalContacts(page: number, pageSize: number, q: string) {
  return useQuery({
    queryKey: [...KEY, page, pageSize, q],
    queryFn: () => api<Page<GlobalContactDto>>("GET", withQuery("/api/global-contacts", { page, pageSize, q })),
    placeholderData: keepPreviousData,
  });
}

const refresh = (qc: ReturnType<typeof useQueryClient>) => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ["people"] })]);

export function useCreateGlobalContact() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: GlobalContactInput) => api<GlobalContactDto>("POST", "/api/global-contacts", input), onSettled: () => refresh(qc) });
}

export function useUpdateGlobalContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: GlobalContactInput & { id: string }) => api<GlobalContactDto>("PUT", `/api/global-contacts/${encodeURIComponent(id)}`, input),
    onSettled: () => refresh(qc),
  });
}

export function useDeleteGlobalContact() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api<void>("DELETE", `/api/global-contacts/${encodeURIComponent(id)}`), onSettled: () => refresh(qc) });
}
