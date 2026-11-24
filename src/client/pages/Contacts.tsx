import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ContactDto } from "@shared/api";
import {
  Button, Empty, ErrorNotice, FillPage, LoadingRows, PageHeader, Pagination, Select, Table, TableCard, TextInput, Td, Th, fmt,
} from "@/components/ui";
import { ContactPanel } from "@/components/panels/ContactPanel";
import { useDebounced } from "@/hooks/useDebounced";
import { usePanel } from "@/hooks/usePanel";
import { useContacts, useIndustries } from "@/services/contacts";

const PAGE_SIZE = 50;
const location = (c: ContactDto) => [c.city, c.state].filter(Boolean).join(", ") || "n/a"; // the country has its own column
const fullName = (c: { firstName: string; lastName: string }) => [c.firstName, c.lastName].filter(Boolean).join(" ");

export function Contacts() {
  // The search box in the top bar sends you here with ?q=...; typing in this page's own box works as before.
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const fromBar = params.get("q") ?? "";
  useEffect(() => { setQ(fromBar); setPage(1); }, [fromBar]);
  const [industry, setIndustry] = useState("");
  const [page, setPage] = useState(1);
  const panel = usePanel<ContactDto | "new">();

  const search = useDebounced(q.trim());
  const list = useContacts({ page, pageSize: PAGE_SIZE, q: search, industry });
  const industries = useIndustries();
  const total = list.data?.total ?? 0;

  return (
    <FillPage>
      <PageHeader
        title="Contacts"
        description={list.data ? `${fmt(total)} contact${total === 1 ? "" : "s"} match. One row per email address across all imports.` : "One row per email address across all imports."}
        actions={<Button variant="primary" onClick={() => panel.show("new")}>Add contact</Button>}
      />
      <TableCard>
        <div className="flex shrink-0 flex-wrap gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <TextInput className="max-w-sm" placeholder="Search name, title, email or company" aria-label="Search contacts" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select className="max-w-[14rem]" aria-label="Filter by industry" value={industry} onChange={(e) => { setIndustry(e.target.value); setPage(1); }}>
            <option value="">All industries</option>
            {industries.data?.map((i) => <option key={i}>{i}</option>)}
          </Select>
        </div>

        {list.isError ? (
          <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : list.isPending ? (
          <div className="min-h-0 flex-1 overflow-auto"><LoadingRows cols={6} /></div>
        ) : (
          <>
            <Table fill>
              <thead>
                <tr><Th>Contact</Th><Th>Company</Th><Th>Email</Th><Th>Industry</Th><Th>Location</Th><Th>Country</Th></tr>
              </thead>
              <tbody>
                {list.data.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => panel.show(c)}>
                    <Td>
                      <button className="text-left font-medium hover:text-brand-600 dark:hover:text-brand-400" onClick={(e) => { e.stopPropagation(); panel.show(c); }}>
                        {fullName(c) || "(no name)"}
                      </button>
                      <p className="max-w-[16rem] truncate text-xs text-slate-500">{c.title}</p>
                    </Td>
                    <Td className="max-w-[14rem] truncate">{c.companyName}</Td>
                    <Td className="text-slate-600 dark:text-slate-300">{c.email}</Td>
                    <Td className="text-slate-600 dark:text-slate-300">{c.industry}</Td>
                    <Td className="whitespace-nowrap text-slate-600 dark:text-slate-300">{location(c)}</Td>
                    <Td className="whitespace-nowrap text-slate-600 dark:text-slate-300">{c.country || "n/a"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {list.data.items.length === 0 && (
              <Empty>{search || industry ? "No contacts match your filters." : "No contacts yet. Add one, or import a CSV."}</Empty>
            )}
            <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </TableCard>

      {panel.item !== null && <ContactPanel key={`${panel.item === "new" ? "new" : panel.item.id}-${panel.nonce}`} contact={panel.item === "new" ? null : panel.item} open={panel.open} onClose={panel.close} onExited={panel.onExited} />}
    </FillPage>
  );
}
