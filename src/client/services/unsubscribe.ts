import { useMutation, useQuery } from "@tanstack/react-query";
import type { UnsubscribeInfoDto, UnsubscribeResultDto } from "@shared/api";
import { api } from "./http";

/** What the unsubscribe page shows for the link in the address. Public: no sign-in. Changes nothing. */
export function useUnsubscribeInfo(token: string) {
  return useQuery({ queryKey: ["unsubscribe", token], queryFn: () => api<UnsubscribeInfoDto>("GET", `/api/unsubscribe/${encodeURIComponent(token)}`), retry: false });
}

/** Unsubscribes, after the person pressed the button. */
export function useUnsubscribe(token: string) {
  return useMutation({ mutationFn: () => api<UnsubscribeResultDto>("POST", `/api/unsubscribe/${encodeURIComponent(token)}`) });
}
