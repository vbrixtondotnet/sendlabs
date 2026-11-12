import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AvailableTemplateDto, AvailableTemplateFullDto, EmailTemplateDto, EmailTemplateSummaryDto } from "@shared/api";
import { api } from "./http";

const KEY = ["email-templates"] as const;
const AVAILABLE = ["email-templates", "available"] as const;

/** My Templates: the organization's own list (without bodies). Administrators and Campaign Managers. */
export function useEmailTemplates() {
  return useQuery({ queryKey: KEY, queryFn: () => api<{ items: EmailTemplateSummaryDto[] }>("GET", "/api/email-templates"), staleTime: 15_000 });
}

/** One of My Templates with its body. Fetched when it is previewed or used, not with the list. */
export const fetchEmailTemplate = (id: string) => api<EmailTemplateDto>("GET", `/api/email-templates/${encodeURIComponent(id)}`);

export function useEmailTemplate(id: string | null) {
  return useQuery({ queryKey: [...KEY, id], queryFn: () => fetchEmailTemplate(id!), enabled: id !== null });
}

/** Available Templates: the ones made by the system, the same for everyone (read-only). */
export function useAvailableTemplates() {
  return useQuery({ queryKey: AVAILABLE, queryFn: () => api<{ items: AvailableTemplateDto[] }>("GET", "/api/email-templates/available"), staleTime: 60_000 });
}

export function useAvailableTemplate(key: string | null) {
  return useQuery({
    queryKey: [...AVAILABLE, key],
    queryFn: () => api<AvailableTemplateFullDto>("GET", `/api/email-templates/available/${encodeURIComponent(key!)}`),
    enabled: key !== null,
  });
}

/** Administrators only (the API answers 403 otherwise): write a new template into My Templates. */
export function useCreateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; htmlBody: string }) => api<EmailTemplateDto>("POST", "/api/email-templates", input),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Administrators only: copy an Available template into My Templates. */
export function useAddAvailableTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api<EmailTemplateDto>("POST", `/api/email-templates/available/${encodeURIComponent(key)}/add`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Administrators only: take a template out of My Templates. */
export function useRemoveEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/api/email-templates/${encodeURIComponent(id)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
