import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SenderStatusDto } from "@shared/api";
import { api } from "./http";

const KEY = ["sender"] as const;

/** Whether this tenant has a connected email account, and whether the server can connect one at all. */
export function useSender() {
  return useQuery({ queryKey: KEY, queryFn: () => api<SenderStatusDto>("GET", "/api/sender"), staleTime: 30_000 });
}

/** Asks the server to start the connection. It answers with Google's consent-screen address; the caller navigates there. */
export function useConnectGmail() {
  return useMutation({ mutationFn: () => api<{ url: string }>("POST", "/api/sender/gmail/connect") });
}

export function useDisconnectSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("DELETE", "/api/sender"),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
