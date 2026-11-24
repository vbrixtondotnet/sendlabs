import { useState } from "react";
import type { GlobalContactDto } from "@shared/api";
import { Button, Field, Notice, TextInput } from "@/components/ui";
import { SlidePanel } from "@/components/SlidePanel";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useCreateGlobalContact, useUpdateGlobalContact, type GlobalContactInput } from "@/services/globalContacts";

const errorText = (e: unknown) => (e instanceof ApiClientError ? e.fieldErrors[0]?.message ?? e.message : "Something went wrong. Please try again.");
const BLANK: GlobalContactInput = { firstName: "", lastName: "", title: "", company: "", email: "", employeeCount: null, industry: "", website: "", city: "", state: "", country: "" };

/** Add a person to the shared directory, or edit one (SuperAdmin), in a SlidePanel. */
export function GlobalContactPanel({ person, open, onClose, onExited }: { person: GlobalContactDto | null; open: boolean; onClose: () => void; onExited?: () => void }) {
  const { toast } = useToast();
  const create = useCreateGlobalContact();
  const update = useUpdateGlobalContact();
  const [form, setForm] = useState<GlobalContactInput>(person ? { firstName: person.firstName, lastName: person.lastName, title: person.title, company: person.company, email: person.email, employeeCount: person.employeeCount, industry: person.industry, website: person.website, city: person.city, state: person.state, country: person.country } : BLANK);
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;
  const text = (key: Exclude<keyof GlobalContactInput, "employeeCount">) => ({
    id: `gc-${key}`,
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });
  const empty = Object.entries(form).every(([k, v]) => (k === "employeeCount" ? v === null : String(v).trim() === ""));

  async function save() {
    setError(null);
    try {
      if (person) await update.mutateAsync({ id: person.id, ...form });
      else await create.mutateAsync(form);
      toast(person ? "Person saved" : "Person added");
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <SlidePanel
      open={open}
      onExited={() => onExited?.()}
      size="lg"
      title={person ? "Edit person" : "Add person"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || empty} onClick={() => void save()}>{busy ? "Saving…" : person ? "Save changes" : "Add person"}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="gc-firstName"><TextInput {...text("firstName")} /></Field>
        <Field label="Last name" htmlFor="gc-lastName"><TextInput {...text("lastName")} /></Field>
        <Field label="Title" htmlFor="gc-title"><TextInput {...text("title")} /></Field>
        <Field label="Company" htmlFor="gc-company"><TextInput {...text("company")} /></Field>
        <Field label="Email address" htmlFor="gc-email"><TextInput type="email" {...text("email")} /></Field>
        <Field label="Employees" htmlFor="gc-employees">
          <TextInput id="gc-employees" inputMode="numeric" value={form.employeeCount ?? ""} onChange={(e) => { const n = e.target.value.replace(/\D/g, ""); setForm((f) => ({ ...f, employeeCount: n === "" ? null : Number(n) })); }} />
        </Field>
        <Field label="Industry" htmlFor="gc-industry"><TextInput {...text("industry")} /></Field>
        <Field label="Website" htmlFor="gc-website"><TextInput {...text("website")} /></Field>
        <Field label="City" htmlFor="gc-city"><TextInput {...text("city")} /></Field>
        <Field label="State" htmlFor="gc-state"><TextInput {...text("state")} /></Field>
        <Field label="Country" htmlFor="gc-country"><TextInput {...text("country")} /></Field>
      </div>
      {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
    </SlidePanel>
  );
}
