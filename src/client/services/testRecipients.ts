import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TestRecipientDto, TestSendResultDto } from "@shared/api";
import { api } from "./http";

const KEY = ["test-recipients"] as const;

/** The test-send allowlist: the only addresses a campaign test is ever mailed to. */
export function useTestRecipients() {
  return useQuery({ queryKey: KEY, queryFn: () => api<{ items: TestRecipientDto[] }>("GET", "/api/test-recipients") });
}

export function useAddTestRecipient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api<TestRecipientDto>("POST", "/api/test-recipients", { email }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRemoveTestRecipient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/test-recipients/${encodeURIComponent(id)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Mails a saved campaign to the allowlist. The request carries no addresses: the server uses the list. */
export function useSendTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) => api<TestSendResultDto>("POST", `/api/campaigns/${encodeURIComponent(campaignId)}/test-send`),
    // A rejected connection is flagged on the server, which changes what the Sender tab shows.
    onError: () => qc.invalidateQueries({ queryKey: ["sender"] }),
  });
}
