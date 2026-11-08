import type { ReactElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, vi } from "vitest";
import type { CampaignDto, CampaignSummaryDto, ContactDto, ImportDto, InvitationDto, Page, RecipientDto, SenderDto, SenderStatusDto, UserDto } from "../../src/shared/api";
import type { Role } from "../../src/shared/types";
import { RoleProvider } from "../../src/client/hooks/useRole";
import { ToastProvider } from "../../src/client/hooks/useToast";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

export interface Call { method: string; path: string; query: URLSearchParams; body: any; form?: { file: File; mapping: Record<string, number> } }
type Reply = { status?: number; json?: unknown } | undefined;
export type Handler = (call: Call) => Reply;

/** Stubs `fetch` with a router and records every request. Unhandled requests fail the test loudly. */
export function stubApi(handler: Handler) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    if (init?.body instanceof FormData) {
      call.form = { file: init.body.get("file") as File, mapping: JSON.parse(String(init.body.get("mapping"))) };
      // a multipart upload must not carry a JSON content-type: the browser sets the boundary itself
      if (init.headers && "content-type" in (init.headers as Record<string, string>)) throw new Error("multipart request had a JSON content-type");
    }
    calls.push(call);
    const reply = handler(call);
    if (!reply) throw new Error(`Unhandled request: ${call.method} ${call.path}${url.search}`);
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.json ?? {}), { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

/** Where the router ends up when the page under test sends the user somewhere else. `data-location` is the full address. */
function Elsewhere() {
  const l = useLocation();
  return <div data-testid="elsewhere" data-location={l.pathname + l.search} />;
}

export function renderAt(ui: ReactElement, opts: { path?: string; route?: string; role?: Role } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const { path = "/", route = "*", role = "Administrator" } = opts;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <RoleProvider initial={role}>
          <ToastProvider>
            <Routes>
              <Route path={route} element={ui} />
              <Route path="*" element={<Elsewhere />} />
            </Routes>
          </ToastProvider>
        </RoleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/* ------------------------------ fixtures ------------------------------ */

export const page = <T,>(items: T[], total = items.length, p = 1, pageSize = 25): Page<T> => ({ items, total, page: p, pageSize });

const ts = "2026-11-06T14:30:00.000Z";

export const contact = (over: Partial<ContactDto> = {}): ContactDto => ({
  id: "c1", email: "nick@flexecutioninc.com", firstName: "Nick", lastName: "Harbaugh", title: "VP International",
  companyName: "Flexecution", employees: 53, industry: "retail", linkedinUrl: "", website: "", city: "Los Angeles",
  state: "California", country: "United States", annualRevenue: 16175000, consentStatus: "Unknown", consentSource: null,
  sourceImportId: null, createdAt: ts, updatedAt: ts, ...over,
});

const zero = { Pending: 0, Queued: 0, Processing: 0, Accepted: 0, Failed: 0, Skipped: 0, Cancelled: 0 };

export const campaign = (over: Partial<CampaignDto> = {}): CampaignDto => ({
  id: "k1", name: "Access-to-SQL", subject: "Hi {{firstName}}", htmlBody: "<p>Hello {{firstName}} <a href=\"{{unsubscribeUrl}}\">unsubscribe</a></p>",
  textBody: null, status: "Draft", senderAccountId: null, recipientImportId: null, createdBy: "dev@local", dailyLimit: 500, sendWindowStart: "09:00",
  sendWindowEnd: "17:00", timezone: "America/Los_Angeles", nextRunAt: null, lastRunAt: null, launchedAt: null, completedAt: null,
  archivedAt: null, createdAt: ts, updatedAt: ts, totals: { ...zero }, ...over,
});

export const summary = (over: Partial<CampaignDto> = {}): CampaignSummaryDto => {
  const { htmlBody: _h, textBody: _t, ...rest } = campaign(over);
  return rest;
};

export const recipient = (over: Partial<RecipientDto> = {}): RecipientDto => ({
  id: "r1", campaignId: "k1", contactId: "c1", email: "nick@flexecutioninc.com", personalization: { firstName: "Nick", lastName: "Harbaugh" },
  sequence: 1, status: "Pending", skipReason: null, attemptCount: 0, queuedAt: null, acceptedAt: null, lastError: null,
  createdAt: ts, updatedAt: ts, ...over,
});

export const totals = (over: Partial<typeof zero> = {}) => ({ ...zero, ...over });

export const importDto = (over: Partial<ImportDto> = {}): ImportDto => ({
  id: "imp1", filename: "template.csv", fileSize: 4096, status: "Completed", columnMapping: { email: 4 }, totalRows: 25, validRows: 25,
  createdContacts: 25, existingContacts: 0, counts: { malformed: 0, badRow: 0, duplicate: 0, blank: 0 }, rejectedRows: 0, numericWarnings: 0,
  error: null, createdBy: "dev@local", createdAt: ts, completedAt: ts, ...over,
});

export const userDto = (over: Partial<UserDto> = {}): UserDto => ({
  id: "u1", email: "admin@sabertoothsoftwarelabs.net", firstName: "", lastName: "", displayName: "Administrator", access: "Administrator", accessId: "administrator",
  status: "Active", mustChangePassword: false, lastLoginAt: null, createdAt: ts, ...over,
});

export const invitationDto = (over: Partial<InvitationDto> = {}): InvitationDto => ({
  id: "inv1", email: "pat@example.test", firstName: "Pat", lastName: "Lee", access: "Viewer", accessId: "viewer", status: "Pending",
  invitedBy: "admin@sabertoothsoftwarelabs.net", createdAt: ts, expiresAt: "2026-11-13T14:30:00.000Z", ...over,
});

export const senderDto =(over: Partial<SenderDto> = {}): SenderDto => ({
  id: "s1", provider: "gmail", email: "sales@acme.test", status: "Connected", permissions: ["Send email"],
  connectedBy: "admin@sabertoothsoftwarelabs.net", connectedAt: ts, ...over,
});

/** What GET /api/sender returns. `sender: null` = nothing connected. */
export const senderStatus = (sender: SenderDto | null = senderDto(), configured = true): SenderStatusDto => ({ configured, sender });
