import { useState } from "react";
import type { GlobalContactDto } from "@shared/api";
import { Button, Empty, ErrorNotice, FillPage, LoadingRows, Modal, PageHeader, Pagination, Table, TableCard, TextInput, Td, Th, fmt } from "@/components/ui";
import { RowActions, type RowAction } from "@/components/RowActions";
import { GlobalContactPanel } from "@/components/panels/GlobalContactPanel";
import { useDebounced } from "@/hooks/useDebounced";
import { usePanel } from "@/hooks/usePanel";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useDeleteGlobalContact, useGlobalContacts } from "@/services/globalContacts";

const PAGE_SIZE = 50;
const fullName = (c: { firstName: string; lastName: string }) => [c.firstName, c.lastName].filter(Boolean).join(" ");
const errorText = (e: unknown) => (e instanceof ApiClientError ? e.fieldErrors[0]?.message ?? e.message : "Something went wrong. Please try again.");

/** Global Contacts (SuperAdmin only): the shared directory that every account searches in Search People. Add, edit and delete people. */
export function GlobalContacts() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const panel = usePanel<GlobalContactDto | "new">();
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
        actions={<Button variant="primary" onClick={() => panel.show("new")}>Add person</Button>}
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
                        { label: "Edit", icon: "edit", ariaLabel: `Edit ${fullName(p) || p.email || p.company}`, onSelect: () => panel.show(p) },
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

      {panel.item && <GlobalContactPanel key={`${panel.item === "new" ? "new" : panel.item.id}-${panel.nonce}`} person={panel.item === "new" ? null : panel.item} open={panel.open} onClose={panel.close} onExited={panel.onExited} />}

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
