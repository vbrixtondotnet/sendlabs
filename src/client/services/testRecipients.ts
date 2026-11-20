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

/** Mails a saved campaign to the chosen allowlisted addresses (the server refuses any that is not on the allowlist). */
export function useSendTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { campaignId: string; to: string[] }) =>
      api<TestSendResultDto>("POST", `/api/campaigns/${encodeURIComponent(input.campaignId)}/test-send`, { to: input.to }),
    // A rejected connection is flagged on the server, which changes what the Sender tab shows.
    onError: () => qc.invalidateQueries({ queryKey: ["sender"] }),
  });
}
