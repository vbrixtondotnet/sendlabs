import { useState } from "react";
import type { ContactDto } from "@shared/api";
import { CONSENT_STATUSES, type ConsentStatus } from "@shared/types";
import { Button, Field, Notice, Select, TextInput, fmtDay } from "@/components/ui";
import { SlidePanel } from "@/components/SlidePanel";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useCreateContact, useDeleteContact, useUpdateContact } from "@/services/contacts";

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

/** Add a contact, or see and edit one, in a SlidePanel. */
export function ContactPanel({ contact, open, onClose, onExited }: { contact: ContactDto | null; open: boolean; onClose: () => void; onExited?: () => void }) {
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
      <TextInput id={id} type={extra?.type ?? "text"} value={form[key]} onChange={set(key)} disabled={busy} aria-invalid={err(key) ? true : undefined} />
      {err(key) && <p className="mt-1 text-xs text-rose-600">{err(key)}</p>}
    </Field>
  );

  return (
    <SlidePanel
      open={open}
      onExited={() => onExited?.()}
      size="lg"
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
            {contact && <Button variant="ghost" className="mr-auto text-rose-600" onClick={() => setConfirmDelete(true)}>Delete</Button>}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy || form.email.trim() === ""} onClick={save}>{busy ? "Saving…" : contact ? "Save changes" : "Add contact"}</Button>
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
          <Select id="c-consent" value={form.consentStatus} onChange={set("consentStatus")} disabled={busy}>
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
    </SlidePanel>
  );
}
