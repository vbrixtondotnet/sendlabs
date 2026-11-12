import { useState, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { ApiClientError } from "@/services/http";
import { useMe } from "@/services/me";

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: "/", label: "Overview", end: true, icon: <path d="M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" /> },
  { to: "/imports", label: "Imports", icon: <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3" /> },
  { to: "/contacts", label: "Contacts", icon: <path d="M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21c0-4 4-6 8-6s8 2 8 6" /> },
  { to: "/campaigns", label: "Campaigns", icon: <path d="M3 7l9 6 9-6M3 7v10h18V7H3z" /> },
  { to: "/templates", label: "Email Templates", icon: <path d="M6 3h9l4 4v14H6V3zM14 3v5h5M9 12h7M9 16h7" /> },
  { to: "/settings", label: "Settings", icon: <path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1v-2z" /> },
];

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const me = useMe();
  const location = useLocation();

  // Not signed in: go to the login page, and come back to this page afterwards.
  if (me.error instanceof ApiClientError && me.error.status === 401) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  // Settings belong to Administrators: everyone else does not even see the menu item (the page and the API refuse them too).
  const isAdmin = me.data?.user.access === "Administrator";
  // Viewers have no access to Email Templates, so they do not see that item either.
  const isViewer = me.data?.user.access === "Viewer";
  const items = NAV.filter((n) => (n.to !== "/settings" || isAdmin) && (n.to !== "/templates" || !isViewer));

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1 px-3">
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end ?? false}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
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
        {isAdmin && <p className="px-6 text-xs text-slate-400">Settings are a preview</p>}
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
          {me.data ? (
            <span className="truncate text-sm font-medium" title={me.data.tenant.slug}>{me.data.tenant.name}</span>
          ) : me.isError ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Not signed in</span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {me.data && <UserMenu user={me.data.user} />}
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
    <div className="px-6">
      <Logo className="h-8" />
    </div>
  );
}
