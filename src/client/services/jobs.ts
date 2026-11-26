import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompanyContactDto, ContactEmailDto, HiringCompaniesDto, JobCategoryDto, JobDescriptionDto, JobsPageDto, MeDto, ShareConfirmDto, ShareStartDto, SharedJobDto } from "@shared/api";
import type { ShareNetwork } from "@shared/shares";
import type { JobSort } from "@shared/schemas";
import { api, withQuery } from "./http";

export interface JobFilters {
  keyword: string;
  /** Remotive's category value, or "" for all. */
  category: string;
  locations: string[];
  remoteOnly: boolean;
  /** Only this company's jobs ("" for all): View Company in Hiring Companies. */
  company: string;
  sort: JobSort;
}

/**
 * One page of live jobs, from Remotive, Arbeitnow and Jobicy merged. Our server asks them (the browser never does), filters, sorts and pages them. React Query hands the
 * request an abort signal, so a search that has already been replaced is cancelled instead of finished.
 */
export function useJobs(filters: JobFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: ["jobs", filters, page, pageSize],
    queryFn: ({ signal }) =>
      api<JobsPageDto>(
        "GET",
        withQuery("/api/jobs", {
          page,
          pageSize,
          keyword: filters.keyword,
          category: filters.category,
          locations: filters.locations.join(","),
          remoteOnly: filters.remoteOnly ? "true" : undefined,
          company: filters.company,
          sort: filters.sort,
        }),
        undefined,
        signal,
      ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false, // a failure is shown with a Try again button; retrying by itself would only hit Remotive more
  });
}

/**
 * The Hiring Companies panel: the companies in the current search's results, each with how many of those jobs are its own. It follows the
 * same filters as the job list (keyword, category, locations, Remote only) but not the company chosen with View Company, so the panel keeps
 * offering the other companies while one is shown.
 */
export function useHiringCompanies(filters: Omit<JobFilters, "company" | "sort">) {
  return useQuery({
    queryKey: ["jobs", "companies", filters],
    queryFn: ({ signal }) =>
      api<HiringCompaniesDto>(
        "GET",
        withQuery("/api/jobs/companies", {
          keyword: filters.keyword,
          category: filters.category,
          locations: filters.locations.join(","),
          remoteOnly: filters.remoteOnly ? "true" : undefined,
        }),
        undefined,
        signal,
      ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });
}

/** The choices of the Category filter (Remotive's own list). */
export function useJobCategories() {
  return useQuery({
    queryKey: ["jobs", "categories"],
    queryFn: ({ signal }) => api<{ items: JobCategoryDto[] }>("GET", "/api/jobs/categories", undefined, signal),
    staleTime: 60 * 60_000,
    retry: false,
  });
}

/** The choices of the Location filter: the places named by the current jobs. */
export function useJobLocations() {
  return useQuery({
    queryKey: ["jobs", "locations"],
    queryFn: ({ signal }) => api<{ items: string[] }>("GET", "/api/jobs/locations", undefined, signal),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** The words of an application email, and the files that go with it. */
export interface ApplicationEmailInput {
  to: string;
  subject: string;
  body: string;
  attachments: File[];
  /** The job it is for: only used to word the confirmation email you get afterwards. */
  jobTitle?: string;
  companyName?: string;
}

/** Sends an application email from the Apply panel: one recipient, no CC or BCC, as multipart form data (the files travel as they are). */
export function useSendApplicationEmail() {
  return useMutation({
    mutationFn: (input: ApplicationEmailInput) => {
      const form = new FormData();
      form.append("to", input.to);
      form.append("subject", input.subject);
      form.append("body", input.body);
      if (input.jobTitle) form.append("jobTitle", input.jobTitle);
      if (input.companyName) form.append("companyName", input.companyName);
      for (const f of input.attachments) form.append("attachments", f, f.name);
      return api<{ sent: boolean; attachments: number }>("POST", "/api/jobs/apply-email", form);
    },
  });
}

/**
 * Get Email Address (Apply panel): asks the server to find the contact email of a company with Hunter.io. A mutation, so it only runs
 * when the button is pressed. When an address is found the credits shown in the header drop to the new balance at once.
 */
export function useFindContactEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (companyName: string) => api<ContactEmailDto>("POST", "/api/jobs/contact-email", { companyName }),
    onSuccess: (result) => qc.setQueryData<MeDto>(["me"], (me) => (me ? { ...me, user: { ...me.user, credits: result.credits } } : me)),
    retry: false,
  });
}

/**
 * Add to Contacts on a Hiring Companies card: the server finds the company's contact person (Hunter.io) and adds them to your contacts for 1
 * credit, only when one is found. The credits in the header and the Contacts list refresh from the result.
 */
export function useAddCompanyContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (companyName: string) => api<CompanyContactDto>("POST", "/api/jobs/companies/add-contact", { companyName }),
    onSuccess: (result) => {
      qc.setQueryData<MeDto>(["me"], (me) => (me ? { ...me, user: { ...me.user, credits: result.credits } } : me));
      void qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    retry: false,
  });
}

/** The description of one job, loaded when its View Job panel opens (the list does not carry descriptions: there are hundreds of them). */
export function useJobDescription(id: string) {
  return useQuery({
    queryKey: ["jobs", "description", id],
    queryFn: ({ signal }) => api<JobDescriptionDto>("GET", withQuery("/api/jobs/description", { id }), undefined, signal),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** Starts sharing a job to LinkedIn or Facebook: the server saves a copy for the public link and answers with it. */
export function useStartShare() {
  return useMutation({
    mutationFn: (input: { jobId: string; title: string; network: ShareNetwork }) => api<ShareStartDto>("POST", "/api/jobs/share", input),
    retry: false,
  });
}

/** "I've posted it": the server gives the credit (once), and the credits in the header show the new balance at once. */
export function useConfirmShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => api<ShareConfirmDto>("POST", `/api/jobs/share/${encodeURIComponent(shareId)}/confirm`),
    onSuccess: (result) => qc.setQueryData<MeDto>(["me"], (me) => (me ? { ...me, user: { ...me.user, credits: result.credits } } : me)),
    retry: false,
  });
}

/** The job on the public share page (/share/<id>): no sign-in needed. */
export function useSharedJob(id: string) {
  return useQuery({
    queryKey: ["shared-job", id],
    queryFn: ({ signal }) => api<SharedJobDto>("GET", `/api/share/${encodeURIComponent(id)}`, undefined, signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
