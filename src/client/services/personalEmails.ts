import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PersonalEmailDto, PersonalEmailsDto } from "@shared/api";
import { api } from "./http";

const KEY = ["personal-emails"] as const;

/** The recent one-to-one emails and how much of today's allowance is used. Administrators and Campaign Managers. */
export function usePersonalEmails(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: () => api<PersonalEmailsDto>("GET", "/api/personal-emails"), staleTime: 15_000, enabled });
}

/** Sends one email to one person, now. */
export function useSendPersonalEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { to: string; replyTo?: string; subject: string; body: string }) => api<PersonalEmailDto>("POST", "/api/personal-emails", input),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
