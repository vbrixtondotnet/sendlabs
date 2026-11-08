import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { MeDto } from "@shared/api";
import { goTo } from "@/lib/navigate";
import { useSignOut } from "@/services/auth";
import { initialsOf } from "@/services/me";

const itemCls = "block w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:bg-slate-800";

/**
 * The round initials button in the header. Clicking it opens a small menu: Settings (your own profile and password)
 * and Logout. It closes on Escape, on a click anywhere else, and after choosing something.
 */
export function UserMenu({ user }: { user: MeDto["user"] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const signOut = useSignOut();
  const name = user.displayName || user.email;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); button.current?.focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Signed in as ${user.email}`}
        title={`${name} (${user.email})`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
      >
        {initialsOf(user.displayName, user.email)}
      </button>

      {open && (
        <div role="menu" aria-label="Account menu" className="absolute right-0 z-30 mt-2 w-60 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <div className="pt-1">
            <Link role="menuitem" to="/account" onClick={() => setOpen(false)} className={itemCls}>Settings</Link>
            <button
              role="menuitem"
              type="button"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate(undefined, { onSettled: () => goTo("/login") })}
              className={`${itemCls} disabled:opacity-50`}
            >
              {signOut.isPending ? "Logging out…" : "Logout"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
