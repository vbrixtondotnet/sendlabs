import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CampaignDto, CampaignSummaryDto, Page, RecipientDto } from "@shared/api";
import type { CampaignStatus, RecipientStatus } from "@shared/types";
import type { CampaignCreate, CampaignPatch } from "@shared/schemas";
import type { CampaignAction } from "@shared/status";
import { api, withQuery } from "./http";

export interface CampaignFilters {
  page: number;
  pageSize: number;
  q?: string;
  status?: CampaignStatus | "";
  archived?: "exclude" | "include" | "only";
}

export interface RecipientFilters {
  page: number;
  pageSize: number;
  q?: string;
  status?: RecipientStatus | "";
}

const keys = {
  all: ["campaigns"] as const,
  list: (f: CampaignFilters) => ["campaigns", "list", f] as const,
  one: (id: string) => ["campaigns", "one", id] as const,
  recipients: (id: string, f: RecipientFilters) => ["campaigns", "recipients", id, f] as const,
};

export function useCampaigns(filters: CampaignFilters, opts?: { refetchMs?: number }) {
  return useQuery({
    queryKey: keys.list(filters),
    queryFn: () => api<Page<CampaignSummaryDto>>("GET", withQuery("/api/campaigns", { ...filters })),
    placeholderData: keepPreviousData,
    ...(opts?.refetchMs ? { refetchInterval: opts.refetchMs } : {}),
  });
}

/** Refreshes every 10 seconds while the campaign is actively sending. */
export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: keys.one(id ?? ""),
    enabled: Boolean(id),
    queryFn: () => api<CampaignDto>("GET", `/api/campaigns/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "Sending" ? 10_000 : false),
  });
}

export function useRecipients(id: string, filters: RecipientFilters, sending: boolean) {
  return useQuery({
    queryKey: keys.recipients(id, filters),
    queryFn: () => api<Page<RecipientDto>>("GET", withQuery(`/api/campaigns/${id}/recipients`, { ...filters })),
    placeholderData: keepPreviousData,
    refetchInterval: sending ? 10_000 : false,
  });
}

/** Every write refreshes lists, details and recipients so counts never go stale. */
function useCampaignMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }) });
}

export const useCreateCampaign = () =>
  useCampaignMutation((body: Partial<CampaignCreate> & { name: string; subject: string; htmlBody: string }) =>
    api<CampaignDto>("POST", "/api/campaigns", body),
  );

export const useUpdateCampaign = () =>
  useCampaignMutation(({ id, patch }: { id: string; patch: CampaignPatch }) =>
    api<CampaignDto>("PATCH", `/api/campaigns/${id}`, patch),
  );

export const useDeleteCampaign = () =>
  useCampaignMutation((id: string) => api<void>("DELETE", `/api/campaigns/${id}`));

export const useDuplicateCampaign = () =>
  useCampaignMutation((id: string) => api<CampaignDto>("POST", `/api/campaigns/${id}/duplicate`));

export const useArchiveCampaign = () =>
  useCampaignMutation(({ id, archived }: { id: string; archived: boolean }) =>
    api<CampaignDto>("POST", `/api/campaigns/${id}/${archived ? "archive" : "unarchive"}`),
  );

export const useCampaignAction = () =>
  useCampaignMutation(({ id, action }: { id: string; action: CampaignAction }) =>
    api<CampaignDto>("POST", `/api/campaigns/${id}/${action}`),
  );
