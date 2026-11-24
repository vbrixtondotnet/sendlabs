import { useState } from "react";
import type { UserAccountDto } from "@shared/api";
import { Badge, Button, Empty, ErrorNotice, FillPage, LoadingRows, Modal, PageHeader, Table, TableCard, Td, Th, fmtDate } from "@/components/ui";
import { RowActions, type RowAction } from "@/components/RowActions";
import { UserAccountPanel } from "@/components/panels/UserAccountPanel";
import { usePanel } from "@/hooks/usePanel";
import { useMe } from "@/services/me";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useChangeUserAccount, useRemoveUserAccount, useUserAccounts } from "@/services/users";

const errorText = (e: unknown) => (e instanceof ApiClientError ? e.fieldErrors[0]?.message ?? e.message : "Something went wrong. Please try again.");

/** User Accounts (SuperAdmin only): every account, its role and status. Add, edit, disable, reset a password, delete. */
export function UserAccounts() {
  const { toast } = useToast();
  const me = useMe();
  const list = useUserAccounts();
  const change = useChangeUserAccount();
  const remove = useRemoveUserAccount();
  const panel = usePanel<UserAccountDto | "new">();
  const [removing, setRemoving] = useState<UserAccountDto | null>(null);
  const myId = me.data?.user.id;

  async function toggle(u: UserAccountDto) {
    try {
      await change.mutateAsync({ id: u.id, status: u.status === "Active" ? "Disabled" : "Active" });
      toast(u.status === "Active" ? `${u.email} disabled` : `${u.email} enabled`);
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.id);
      toast(`${removing.email} deleted`);
    } catch (e) {
      toast(errorText(e), "error");
    }
    setRemoving(null);
  }

  return (
    <FillPage>
      <PageHeader
        title="User Accounts"
        description="Every account, and what it may use."
        actions={<Button variant="primary" onClick={() => panel.show("new")}>Add account</Button>}
      />
      <TableCard>
        {list.isError ? (
          <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : list.isPending ? (
          <LoadingRows cols={5} rows={5} />
        ) : list.data.items.length === 0 ? (
          <Empty>No accounts.</Empty>
        ) : (
          <Table fill>
            <thead><tr><Th>Account</Th><Th>Role</Th><Th>Status</Th><Th>Last sign-in</Th><Th className="text-right"><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {list.data.items.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <span className="font-medium">{u.displayName || u.email}</span>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </Td>
                  <Td>{u.role}</Td>
                  <Td>{u.status === "Active" ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Disabled</Badge>}</Td>
                  <Td className="text-slate-500">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never"}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <RowActions
                      label={`Actions for ${u.email}`}
                      actions={[
                        { label: "Edit", icon: "edit", ariaLabel: `Edit ${u.email}`, onSelect: () => panel.show(u) },
                        ...(u.id === myId
                          ? []
                          : [
                              { label: u.status === "Active" ? "Disable" : "Enable", icon: "edit", ariaLabel: `${u.status === "Active" ? "Disable" : "Enable"} ${u.email}`, onSelect: () => void toggle(u) },
                              { label: "Delete", icon: "delete", ariaLabel: `Delete ${u.email}`, danger: true, onSelect: () => setRemoving(u) },
                            ]),
                      ] as RowAction[]}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableCard>

      {panel.item && <UserAccountPanel key={`${panel.item === "new" ? "new" : panel.item.id}-${panel.nonce}`} {...(panel.item === "new" ? {} : { account: panel.item, isSelf: panel.item.id === myId })} open={panel.open} onClose={panel.close} onExited={panel.onExited} />}

      <Modal
        open={removing !== null}
        title="Delete account?"
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Keep it</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => void confirmRemove()}>{remove.isPending ? "Deleting…" : "Delete"}</Button>
          </>
        }
      >
        <p className="text-sm"><strong>{removing?.email}</strong> will be removed. An account that already has data cannot be deleted: disable it instead.</p>
      </Modal>
    </FillPage>
  );
}
