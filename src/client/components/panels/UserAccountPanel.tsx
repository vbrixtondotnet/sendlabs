import { useState } from "react";
import type { UserAccountDto } from "@shared/api";
import { ROLES, type Role } from "@shared/types";
import { Button, Field, Notice, Select, TextInput } from "@/components/ui";
import { SlidePanel } from "@/components/SlidePanel";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useAddUserAccount, useChangeUserAccount } from "@/services/users";

const ROLE_HELP: Record<Role, string> = {
  SuperAdmin: "Manages Email Templates, Global Contacts and User Accounts.",
  JobSeeker: "Everything except Campaigns.",
  Agency: "Everything except Jobs.",
};
const errorText = (e: unknown) => (e instanceof ApiClientError ? e.fieldErrors[0]?.message ?? e.message : "Something went wrong. Please try again.");

/** Add an account, or edit one (SuperAdmin), in a SlidePanel. */
export function UserAccountPanel({ account, isSelf = false, open, onClose, onExited }: { account?: UserAccountDto; isSelf?: boolean; open: boolean; onClose: () => void; onExited?: () => void }) {
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
    <SlidePanel
      open={open}
      onExited={() => onExited?.()}
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
    </SlidePanel>
  );
}
