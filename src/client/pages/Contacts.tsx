import { useState } from "react";
import type { ContactDto } from "@shared/api";
import { CONSENT_STATUSES, type ConsentStatus } from "@shared/types";
import {
  Badge, Button, Card, Empty, ErrorNotice, Field, LoadingRows, Modal, Notice, PageHeader, Pagination, Select, Table, TextInput, Td, Th, fmt, fmtDay,
} from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useContacts, useCreateContact, useDeleteContact, useIndustries, useUpdateContact } from "@/services/contacts";

const PAGE_SIZE = 15;
const location = (c: ContactDto) => [c.city, c.state].filter(Boolean).join(", ") || c.country || "n/a";
const fullName = (c: { firstName: string; lastName: string }) => [c.firstName, c.lastName].filter(Boolean).join(" ");
const consentTone = { Granted: "green", Unknown: "slate", Withdrawn: "red" } as const;

export function Contacts() {
  const { canEdit } = useRole();
  const [q, setQ] = useState("");
  const [industry, setIndustry] = useState("");
  const [consent, setConsent] = useState<ConsentStatus | "">("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ContactDto | "new" | null>(null);

  const search = useDebounced(q.trim());
  const list = useContacts({ page, pageSize: PAGE_SIZE, q: search, industry, consent });
  const industries = useIndustries();
  const total = list.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Contacts"
        description={list.data ? `${fmt(total)} contact${total === 1 ? "" : "s"} match. One row per email address across all imports.` : "One row per email address across all imports."}
        actions={canEdit && <Button variant="primary" onClick={() => setEditing("new")}>Add contact</Button>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <TextInput className="max-w-sm" placeholder="Search name, title, email or company" aria-label="Search contacts" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select className="max-w-[14rem]" aria-label="Filter by industry" value={industry} onChange={(e) => { setIndustry(e.target.value); setPage(1); }}>
            <option value="">All industries</option>
            {industries.data?.map((i) => <option key={i}>{i}</option>)}
          </Select>
          <Select className="max-w-[14rem]" aria-label="Filter by consent" value={consent} onChange={(e) => { setConsent(e.target.value as ConsentStatus | ""); setPage(1); }}>
            <option value="">Any consent</option>
            {CONSENT_STATUSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>

        {list.isError ? (
          <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : list.isPending ? (
          <LoadingRows cols={6} />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>Contact</Th><Th>Company</Th><Th>Email</Th><Th>Industry</Th><Th>Location</Th><Th>Consent</Th></tr>
              </thead>
              <tbody>
                {list.data.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setEditing(c)}>
                    <Td>
                      <button className="text-left font-medium hover:text-brand-600 dark:hover:text-brand-400" onClick={(e) => { e.stopPropagation(); setEditing(c); }}>
                        {fullName(c) || "(no name)"}
                      </button>
                      <p className="max-w-[16rem] truncate text-xs text-slate-500">{c.title}</p>
                    </Td>
                    <Td className="max-w-[14rem] truncate">{c.companyName}</Td>
                    <Td className="text-slate-600 dark:text-slate-300">{c.email}</Td>
                    <Td className="text-slate-600 dark:text-slate-300">{c.industry}</Td>
                    <Td className="whitespace-nowrap text-slate-600 dark:text-slate-300">{location(c)}</Td>
                    <Td><Badge tone={consentTone[c.consentStatus]}>{c.consentStatus}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {list.data.items.length === 0 && (
              <Empty>{search || industry || consent ? "No contacts match your filters." : "No contacts yet. Add one, or import a CSV."}</Empty>
            )}
            <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Card>

      {editing !== null && <ContactDialog key={editing === "new" ? "new" : editing.id} contact={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/* ------------------------------ add / edit ------------------------------ */

interface Form {
  email: string; firstName: string; lastName: string; title: string; companyName: string; industry: string;
  city: string; state: string; country: string; employees: string; annualRevenue: string; website: string;
  linkedinUrl: string; consentStatus: ConsentStatus;
}

const toForm = (c: ContactDto | null): Form => ({
  email: c?.email ?? "", firstName: c?.firstName ?? "", lastName: c?.lastName ?? "", title: c?.title ?? "",
  companyName: c?.companyName ?? "", industry: c?.industry ?? "", city: c?.city ?? "", state: c?.state ?? "",
  country: c?.country ?? "", employees: c?.employees?.toString() ?? "", annualRevenue: c?.annualRevenue?.toString() ?? "",
  website: c?.website ?? "", linkedinUrl: c?.linkedinUrl ?? "", consentStatus: c?.consentStatus ?? "Unknown",
});

const num = (s: string) => (s.trim() === "" ? null : Number(s));

function ContactDialog({ contact, onClose }: { contact: ContactDto | null; onClose: () => void }) {
  const { canEdit } = useRole();
  const { toast } = useToast();
  const create = useCreateContact();
  const update = useUpdateContact();
  const del = useDeleteContact();
  const [form, setForm] = useState<Form>(() => toForm(contact));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const error = (create.error ?? update.error ?? del.error) as unknown;
  const busy = create.isPending || update.isPending || del.isPending;
  const fieldErrors = error instanceof ApiClientError ? error.fieldErrors : [];
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const err = (path: string) => fieldErrors.find((f) => f.path === path)?.message;

  const body = () => ({
    email: form.email, firstName: form.firstName, lastName: form.lastName, title: form.title, companyName: form.companyName,
    industry: form.industry, city: form.city, state: form.state, country: form.country, website: form.website,
    linkedinUrl: form.linkedinUrl, consentStatus: form.consentStatus,
    employees: num(form.employees), annualRevenue: num(form.annualRevenue),
  });

  async function save() {
    try {
      if (contact) await update.mutateAsync({ id: contact.id, patch: body() });
      else await create.mutateAsync(body());
      toast(contact ? "Contact saved" : "Contact added");
      onClose();
    } catch { /* shown below */ }
  }
  async function remove() {
    if (!contact) return;
    try {
      await del.mutateAsync(contact.id);
      toast("Contact deleted", "info");
      onClose();
    } catch { /* shown below */ }
  }

  const field = (id: string, label: string, key: keyof Form, extra?: { type?: string; hint?: string }) => (
    <Field label={label} htmlFor={id} {...(extra?.hint ? { hint: extra.hint } : {})}>
      <TextInput id={id} type={extra?.type ?? "text"} value={form[key]} onChange={set(key)} disabled={!canEdit || busy} aria-invalid={err(key) ? true : undefined} />
      {err(key) && <p className="mt-1 text-xs text-rose-600">{err(key)}</p>}
    </Field>
  );

  return (
    <Modal
      open
      wide
      title={contact ? "Contact details" : "Add contact"}
      onClose={onClose}
      footer={
        confirmDelete ? (
          <>
            <span className="mr-auto self-center text-sm">Delete this contact? Past campaigns keep their records.</span>
            <Button onClick={() => setConfirmDelete(false)}>Keep</Button>
            <Button variant="danger" disabled={busy} onClick={remove}>Delete contact</Button>
          </>
        ) : (
          <>
            {contact && canEdit && <Button variant="ghost" className="mr-auto text-rose-600" onClick={() => setConfirmDelete(true)}>Delete</Button>}
            <Button onClick={onClose}>{canEdit ? "Cancel" : "Close"}</Button>
            {canEdit && <Button variant="primary" disabled={busy || form.email.trim() === ""} onClick={save}>{busy ? "Saving…" : contact ? "Save changes" : "Add contact"}</Button>}
          </>
        )
      }
    >
      <div className="space-y-4">
        {error !== null && error !== undefined && (
          <Notice tone="error" title={error instanceof ApiClientError && error.code === "EMAIL_EXISTS" ? "That email already exists" : "Could not save"}>
            {error instanceof ApiClientError ? (
              <>
                <p>{error.message}</p>
                {fieldErrors.length > 0 && <ul className="mt-1 list-disc pl-5">{fieldErrors.map((f) => <li key={f.path}>{f.path}: {f.message}</li>)}</ul>}
              </>
            ) : "Something went wrong."}
          </Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("c-first", "First name", "firstName")}
          {field("c-last", "Last name", "lastName")}
          {field("c-title", "Title", "title")}
          {field("c-company", "Company name", "companyName")}
          {field("c-email", "Email", "email", { type: "email", hint: "Stored trimmed and lower-case. Must be unique." })}
          {field("c-industry", "Industry", "industry")}
          {field("c-city", "City", "city")}
          {field("c-state", "State", "state")}
          {field("c-country", "Country", "country")}
          {field("c-emp", "# Employees", "employees", { type: "number" })}
          {field("c-rev", "Annual revenue (USD)", "annualRevenue", { type: "number" })}
          {field("c-web", "Website", "website", { hint: "http(s) URL" })}
        </div>
        {field("c-li", "Person LinkedIn URL", "linkedinUrl", { hint: "http(s) URL" })}
        <Field label="Consent" htmlFor="c-consent" hint="The CSV has no consent column, so imported contacts start as Unknown.">
          <Select id="c-consent" value={form.consentStatus} onChange={set("consentStatus")} disabled={!canEdit || busy}>
            {CONSENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        {contact && (
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
            <div><dt className="text-slate-500">Added</dt><dd>{fmtDay(contact.createdAt)}</dd></div>
            <div><dt className="text-slate-500">Last updated</dt><dd>{fmtDay(contact.updatedAt)}</dd></div>
          </dl>
        )}
      </div>
    </Modal>
  );
}
