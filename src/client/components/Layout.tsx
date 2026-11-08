import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { Role } from "@shared/types";
import { useRole } from "@/hooks/useRole";

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: "/", label: "Overview", end: true, icon: <path d="M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" /> },
  { to: "/imports", label: "Imports", icon: <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3" /> },
  { to: "/contacts", label: "Contacts", icon: <path d="M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21c0-4 4-6 8-6s8 2 8 6" /> },
  { to: "/campaigns", label: "Campaigns", icon: <path d="M3 7l9 6 9-6M3 7v10h18V7H3z" /> },
  { to: "/settings", label: "Settings", icon: <path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1v-2z" /> },
];

const ROLES: Role[] = ["Administrator", "Campaign Manager", "Viewer"];

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function Layout() {
  const { role, setRole } = useRole();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1 px-3">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end ?? false}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`
          }
        >
          <NavIcon>{n.icon}</NavIcon>
          {n.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white py-5 dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <Brand />
        <div className="mt-6 flex-1">{nav}</div>
        <p className="px-6 text-xs text-slate-400">Live: contacts, campaigns · Mock: imports, settings</p>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="relative h-full w-64 bg-white py-5 dark:bg-slate-900">
            <Brand />
            <div className="mt-6">{nav}</div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-6">
          <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="role-switch" className="hidden text-xs text-slate-500 sm:block">
              Preview as
            </label>
            <select
              id="role-switch"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white" title="Brian V." aria-label="Signed in as Brian V.">
              BV
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-6">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7l9 6 9-6M3 7v10h18V7H3z" /></svg>
      </div>
      <span className="text-lg font-semibold tracking-tight">Sendlab</span>
    </div>
  );
}
