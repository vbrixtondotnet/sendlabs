import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EmailTemplateDto, EmailTemplateSummaryDto } from "@shared/api";
import { api } from "./http";

const KEY = ["email-templates"] as const;

/** The organization's templates (without their bodies). Everyone signed in may read them. */
export function useEmailTemplates() {
  return useQuery({ queryKey: KEY, queryFn: () => api<{ items: EmailTemplateSummaryDto[] }>("GET", "/api/email-templates"), staleTime: 15_000 });
}

/** One template with its body. Fetched when it is previewed or used, not with the list. */
export const fetchEmailTemplate = (id: string) => api<EmailTemplateDto>("GET", `/api/email-templates/${encodeURIComponent(id)}`);

export function useEmailTemplate(id: string | null) {
  return useQuery({ queryKey: [...KEY, id], queryFn: () => fetchEmailTemplate(id!), enabled: id !== null });
}

/** Administrators only (the API answers 403 otherwise). */
export function useCreateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; htmlBody: string }) => api<EmailTemplateDto>("POST", "/api/email-templates", input),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Picks a template for the campaign dropdown, or puts it back. Administrators and Campaign Managers. */
export function useSetTemplateSelected() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; selected: boolean }) => api<EmailTemplateSummaryDto>("PUT", `/api/email-templates/${encodeURIComponent(input.id)}/selected`, { selected: input.selected }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
