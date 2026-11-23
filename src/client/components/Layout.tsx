import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { CreditsBadge } from "@/components/CreditsBadge";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { ApiClientError } from "@/services/http";
import { useMe } from "@/services/me";

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: "/", label: "Overview", end: true, icon: <path d="M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" /> },
  { to: "/imports", label: "Imports", icon: <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3" /> },
  { to: "/contacts", label: "Contacts", icon: <path d="M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21c0-4 4-6 8-6s8 2 8 6" /> },
  { to: "/people", label: "Search People", icon: <path d="M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3.5 3-5 6-5s6 1.5 6 5M17 11a2.5 2.5 0 100-5M17 15c2.5 0 4 1.3 4 4" /> },
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

const COLLAPSED_KEY = "sendrix.nav.collapsed";
const readCollapsed = (): boolean => {
  try { return window.localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
};

/**
 * The app shell, laid out like Gmail on the web: a light canvas with the top bar (menu button, logo, search, credits, account)
 * and the navigation sitting directly on it, a pill-shaped primary button above the navigation, and the page itself in one
 * large rounded white panel that scrolls on its own. On a large screen the menu button folds the navigation down to icons.
 */
export function Layout() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [search, setSearch] = useState("");
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();

  // Not signed in: go to the login page, and come back to this page afterwards.
  if (me.error instanceof ApiClientError && me.error.status === 401) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  // Settings belong to Administrators: everyone else does not even see the menu item (the page and the API refuse them too).
  const isAdmin = me.data?.user.access === "Administrator";
  // Viewers have no access to Email Templates, so they do not see that item either.
  const isViewer = me.data?.user.access === "Viewer";
  // A SuperAdministrator belongs to no tenant: its only screen is Email Templates (the Available Templates it manages).
  const isSuperAdmin = me.data?.user.access === "SuperAdministrator";
  if (isSuperAdmin && location.pathname !== "/templates" && location.pathname !== "/account") return <Navigate to="/templates" replace />;
  const items = NAV.filter((n) => (isSuperAdmin ? n.to === "/templates" : (n.to !== "/settings" || isAdmin) && (n.to !== "/templates" || !isViewer)));
  const canCreate = !!me.data && !isViewer && !isSuperAdmin;
  const wide = location.pathname.startsWith("/people"); // the people table wants the whole width

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* storage unavailable: the choice just is not remembered */ }
  };
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    navigate(q ? `/contacts?q=${encodeURIComponent(q)}` : "/contacts");
  };

  /** `rail`: the folded, icons-only form (large screens only). */
  const nav = (rail: boolean) => (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end ?? false}
          title={rail ? n.label : undefined}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex h-9 items-center rounded-full text-sm transition ${rail ? "mx-auto w-12 justify-center" : "gap-4 pl-4 pr-3"} ${
              isActive
                ? "bg-brand-100 font-semibold text-brand-900 dark:bg-brand-900/50 dark:text-brand-100"
                : "text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
            }`
          }
        >
          <NavIcon>{n.icon}</NavIcon>
          <span className={rail ? "sr-only" : "truncate"}>{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  /** The Gmail "Compose" position: the one thing you most often start from here. */
  const createButton = (rail: boolean) =>
    canCreate && (
      <Link
        to="/campaigns/new"
        onClick={() => setOpen(false)}
        title={rail ? "New campaign" : undefined}
        className={`mb-3 flex items-center rounded-2xl bg-brand-100 font-medium text-brand-900 shadow-sm transition hover:shadow-md dark:bg-brand-900/60 dark:text-brand-50 ${rail ? "mx-auto h-12 w-12 justify-center" : "h-14 gap-3 px-5"}`}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        <span className={rail ? "sr-only" : ""}>New campaign</span>
      </Link>
    );

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <header className="flex h-16 shrink-0 items-center gap-2 px-2 sm:px-4">
        <button
          className="rounded-full p-2.5 text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <button
          className="hidden rounded-full p-2.5 text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800 lg:block"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-pressed={collapsed}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <Link to="/" className="mr-2 flex shrink-0 items-center lg:w-44" aria-label="Sendrix home"><Logo className="h-8" /></Link>

        {!isSuperAdmin && (
          <form onSubmit={submitSearch} role="search" className="hidden max-w-2xl flex-1 sm:block">
            <label className="flex h-12 items-center gap-3 rounded-full bg-slate-200/60 px-4 text-slate-600 transition focus-within:bg-white focus-within:shadow-md dark:bg-slate-800 dark:text-slate-300 dark:focus-within:bg-slate-900">
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                type="search"
                aria-label="Search contacts"
                placeholder="Search contacts"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-500 dark:text-slate-100"
              />
            </label>
          </form>
        )}

        <div className="ml-auto flex items-center gap-3">
          {me.data ? (
            <span className="hidden max-w-[14rem] truncate text-sm text-slate-600 dark:text-slate-300 md:block" title={me.data.tenant.slug}>{me.data.tenant.name}</span>
          ) : me.isError ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Not signed in</span>
          ) : null}
          {me.data && !isSuperAdmin && <CreditsBadge credits={me.data.user.credits} />}
          {me.data && <UserMenu user={me.data.user} />}
        </div>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="relative h-full w-72 bg-canvas px-3 py-4">
            <div className="mb-4 px-3"><Logo className="h-8" /></div>
            {createButton(false)}
            {nav(false)}
          </aside>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Desktop navigation, straight on the canvas */}
        <aside className={`hidden shrink-0 flex-col overflow-y-auto pb-4 pt-1 transition-[width] lg:flex ${collapsed ? "w-[4.5rem]" : "w-64 pl-2 pr-3"}`}>
          {createButton(collapsed)}
          {nav(collapsed)}
          {isAdmin && !collapsed && <p className="mt-auto px-4 pt-4 text-xs text-slate-400">Settings are a preview</p>}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto bg-white px-4 py-5 dark:bg-slate-900 sm:mx-2 sm:mb-2 sm:rounded-2xl sm:px-6 lg:ml-0 lg:mr-4 lg:mb-4">
          <div className={wide ? "w-full" : "mx-auto w-full max-w-7xl"}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
