import { useState } from "react";
import type { GlobalContactDto } from "@shared/api";
import { Button, Empty, ErrorNotice, Field, FillPage, LoadingRows, Modal, Notice, PageHeader, Pagination, Table, TableCard, TextInput, Td, Th, fmt } from "@/components/ui";
import { RowActions, type RowAction } from "@/components/RowActions";
import { useDebounced } from "@/hooks/useDebounced";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useCreateGlobalContact, useDeleteGlobalContact, useGlobalContacts, useUpdateGlobalContact, type GlobalContactInput } from "@/services/globalContacts";

const PAGE_SIZE = 50;
const fullName = (c: { firstName: string; lastName: string }) => [c.firstName, c.lastName].filter(Boolean).join(" ");
const errorText = (e: unknown) => (e instanceof ApiClientError ? e.fieldErrors[0]?.message ?? e.message : "Something went wrong. Please try again.");

const BLANK: GlobalContactInput = { firstName: "", lastName: "", title: "", company: "", email: "", employeeCount: null, industry: "", website: "", city: "", state: "", country: "" };

/** Global Contacts (SuperAdmin only): the shared directory that every account searches in Search People. Add, edit and delete people. */
export function GlobalContacts() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<GlobalContactDto | "new" | null>(null);
  const [removing, setRemoving] = useState<GlobalContactDto | null>(null);
  const search = useDebounced(q.trim());
  const list = useGlobalContacts(page, PAGE_SIZE, search);
  const remove = useDeleteGlobalContact();
  const total = list.data?.total ?? 0;

  async function confirmRemove() {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.id);
      toast("Person removed from the directory");
    } catch (e) {
      toast(errorText(e), "error");
    }
    setRemoving(null);
  }

  return (
    <FillPage>
      <PageHeader
        title="Global Contacts"
        description={list.data ? `${fmt(total)} ${total === 1 ? "person" : "people"} in the shared directory that every account searches in Search People.` : "The shared directory that every account searches in Search People."}
        actions={<Button variant="primary" onClick={() => setEditing("new")}>Add person</Button>}
      />
      <TableCard>
        <div className="flex shrink-0 flex-wrap gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <TextInput className="max-w-sm" placeholder="Search name, title, email or company" aria-label="Search global contacts" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        {list.isError ? (
          <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : list.isPending ? (
          <LoadingRows cols={6} rows={6} />
        ) : list.data.items.length === 0 ? (
          <Empty>{search ? "Nobody matches that search." : "The directory is empty."}</Empty>
        ) : (
          <Table fill>
            <thead><tr><Th>Name</Th><Th>Company</Th><Th>Email</Th><Th>Industry</Th><Th>Country</Th><Th className="text-right"><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <Td><span className="font-medium">{fullName(p) || "n/a"}</span>{p.title && <p className="text-xs text-slate-500">{p.title}</p>}</Td>
                  <Td>{p.company || "n/a"}</Td>
                  <Td>{p.email || "n/a"}</Td>
                  <Td>{p.industry || "n/a"}</Td>
                  <Td>{p.country || "n/a"}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <RowActions
                      label={`Actions for ${fullName(p) || p.email || p.company}`}
                      actions={[
                        { label: "Edit", icon: "edit", ariaLabel: `Edit ${fullName(p) || p.email || p.company}`, onSelect: () => setEditing(p) },
                        { label: "Delete", icon: "delete", ariaLabel: `Delete ${fullName(p) || p.email || p.company}`, danger: true, onSelect: () => setRemoving(p) },
                      ] as RowAction[]}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && total > PAGE_SIZE && <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPage={setPage} />}
      </TableCard>

      {editing && <PersonModal person={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}

      <Modal
        open={removing !== null}
        title="Remove person?"
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Keep them</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => void confirmRemove()}>{remove.isPending ? "Removing…" : "Remove"}</Button>
          </>
        }
      >
        <p className="text-sm"><strong>{removing ? fullName(removing) || removing.email || removing.company : ""}</strong> will no longer appear in Search People. Contacts accounts already added from here stay.</p>
      </Modal>
    </FillPage>
  );
}

function PersonModal({ person, onClose }: { person: GlobalContactDto | null; onClose: () => void }) {
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
    <Modal
      open
      wide
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
    </Modal>
  );
}
