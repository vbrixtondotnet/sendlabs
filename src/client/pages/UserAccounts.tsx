import { useState } from "react";
import type { UserAccountDto } from "@shared/api";
import { ROLES, type Role } from "@shared/types";
import { Badge, Button, Empty, ErrorNotice, Field, FillPage, LoadingRows, Modal, Notice, PageHeader, Select, Table, TableCard, TextInput, Td, Th, fmtDate } from "@/components/ui";
import { RowActions, type RowAction } from "@/components/RowActions";
import { useMe } from "@/services/me";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useAddUserAccount, useChangeUserAccount, useRemoveUserAccount, useUserAccounts } from "@/services/users";

const ROLE_HELP: Record<Role, string> = {
  SuperAdmin: "Manages Email Templates and User Accounts.",
  JobSeeker: "Everything except Campaigns.",
  Agency: "Everything except Jobs.",
};

const errorText = (e: unknown) => (e instanceof ApiClientError ? e.fieldErrors[0]?.message ?? e.message : "Something went wrong. Please try again.");

/** User Accounts (SuperAdmin only): every account, its role and status. Add, edit, disable, reset a password, delete. */
export function UserAccounts() {
  const { toast } = useToast();
  const me = useMe();
  const list = useUserAccounts();
  const change = useChangeUserAccount();
  const remove = useRemoveUserAccount();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<UserAccountDto | null>(null);
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
        actions={<Button variant="primary" onClick={() => setAdding(true)}>Add account</Button>}
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
                        { label: "Edit", icon: "edit", ariaLabel: `Edit ${u.email}`, onSelect: () => setEditing(u) },
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

      {adding && <AccountModal onClose={() => setAdding(false)} />}
      {editing && <AccountModal account={editing} isSelf={editing.id === myId} onClose={() => setEditing(null)} />}

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

function AccountModal({ account, isSelf = false, onClose }: { account?: UserAccountDto; isSelf?: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const add = useAddUserAccount();
  const change = useChangeUserAccount();
  const [email, setEmail] = useState(account?.email ?? "");
  const [firstName, setFirstName] = useState(account?.firstName ?? "");
  const [lastName, setLastName] = useState(account?.lastName ?? "");
  const [role, setRole] = useState<Role>(account?.role ?? "JobSeeker");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = add.isPending || change.isPending;
  const editing = account !== undefined;

  async function save() {
    setError(null);
    try {
      if (editing) {
        await change.mutateAsync({
          id: account.id,
          firstName,
          lastName,
          ...(role !== account.role ? { role } : {}),
          ...(password ? { password } : {}),
        });
        toast("Account saved");
      } else {
        await add.mutateAsync({ email, firstName, lastName, role, password });
        toast(`${email} added`);
      }
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Modal
      open
      title={editing ? `Edit ${account.email}` : "Add account"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || (!editing && (email.trim() === "" || password === ""))} onClick={() => void save()}>{busy ? "Saving…" : editing ? "Save changes" : "Add account"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Email address" htmlFor="ua-email">
          <TextInput id="ua-email" type="email" autoComplete="off" value={email} disabled={editing} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" htmlFor="ua-first"><TextInput id="ua-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
          <Field label="Last name" htmlFor="ua-last"><TextInput id="ua-last" value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
        </div>
        <Field label="Role" htmlFor="ua-role" hint={isSelf ? "You cannot change your own role." : ROLE_HELP[role]}>
          <Select id="ua-role" value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label={editing ? "New password" : "Password"} htmlFor="ua-password" hint={editing ? "Leave empty to keep the current one. A new password is temporary: the person must change it at their next sign-in." : "Temporary: the person must change it at their first sign-in."}>
          <TextInput id="ua-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
