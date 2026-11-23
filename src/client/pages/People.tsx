import { useState } from "react";
import type { PersonDto } from "@shared/api";
import { PEOPLE_COMPANY_SIZES, PEOPLE_COUNTRIES, PEOPLE_MAX_TITLES } from "@shared/people";
import { Button, Card, Empty, ErrorNotice, Field, LoadingRows, PageHeader, Pagination, Select, Td, Th, fmt } from "@/components/ui";
import { MultiSelect } from "@/components/MultiSelect";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useMe } from "@/services/me";
import { useAddPersonContact, usePeopleIndustries, usePeopleSearch, type PeopleFilters } from "@/services/people";

const PAGE_SIZE = 50;
const NONE: PeopleFilters = { countries: [], industries: [], companySize: "", titles: [] };

/** Job titles: type one and press Enter (or comma) to add it; each shows as a removable chip. */
function TitlesInput({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    setText("");
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase()) && value.length < PEOPLE_MAX_TITLES) onChange([...value, t]);
  };
  return (
    <Field label="Job titles" hint="Type a title and press Enter. Matches any of them." htmlFor="people-titles">
      <div className="flex min-h-[2.375rem] flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 focus-within:ring-2 focus-within:ring-brand-500 dark:border-slate-700 dark:bg-slate-900">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((v) => v !== t))}>×</button>
          </span>
        ))}
        <input
          id="people-titles"
          className="min-w-[6rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-slate-400"
          placeholder={value.length === 0 ? "e.g. Marketing Manager" : ""}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
            else if (e.key === "Backspace" && text === "" && value.length > 0) onChange(value.slice(0, -1));
          }}
          onBlur={add}
        />
      </div>
    </Field>
  );
}

const dash = (v: string) => v || "-";

export function People() {
  const [draft, setDraft] = useState<PeopleFilters>(NONE);
  const [applied, setApplied] = useState<PeopleFilters>(NONE);
  const [page, setPage] = useState(1);
  const { toast } = useToast();
  const list = usePeopleSearch(applied, page, PAGE_SIZE);
  const industries = usePeopleIndustries();
  const me = useMe();
  const add = useAddPersonContact();
  const credits = me.data?.user.credits ?? 0;
  // Which person's button is working, so only that one shows "Adding..." (a second click on it is ignored by `disabled`).
  const adding = add.isPending ? add.variables : null;

  const addContact = (p: PersonDto) =>
    add.mutate(p.id, {
      onSuccess: (r) => toast(r.charged ? `${p.firstName} ${p.lastName}`.trim() + " added to your contacts. 1 credit used." : `${p.firstName} ${p.lastName}`.trim() + " is already in your contacts."),
      onError: (e) => toast(e instanceof ApiClientError && e.code === "INSUFFICIENT_CREDITS" ? "You are out of credits." : e instanceof Error ? e.message : "Could not add this contact", "error"),
    });
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied(draft);
    setPage(1);
  };
  const reset = () => {
    setDraft(NONE);
    setApplied(NONE);
    setPage(1);
  };

  return (
    // Filters on the left, results on the right (like Apollo). On a large screen the page is exactly as tall as the window, so only
    // the filters and the table scroll, each on its own; on a small one the two stack and the page scrolls normally.
    <div className="flex flex-col lg:h-[calc(100vh-6.5rem)]">
      <div className="shrink-0 [&>div]:!mb-3">
        <PageHeader title="People" description="Find people to reach out to, by country, industry, company size and job title." />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <aside className="shrink-0 lg:w-72 lg:overflow-y-auto" aria-label="Filters">
          <Card>
            <form onSubmit={search} className="space-y-4 p-4" aria-label="Search people">
              <MultiSelect label="Country" options={PEOPLE_COUNTRIES} value={draft.countries} onChange={(countries) => setDraft({ ...draft, countries })} placeholder="Search countries..." />
              <MultiSelect label="Industry" options={industries.data?.items ?? []} value={draft.industries} onChange={(industries) => setDraft({ ...draft, industries })} placeholder="Search industries..." />
              <Field label="Company size" htmlFor="people-size">
                <Select id="people-size" value={draft.companySize} onChange={(e) => setDraft({ ...draft, companySize: e.target.value })}>
                  <option value="">Any size</option>
                  {PEOPLE_COMPANY_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label} employees</option>)}
                </Select>
              </Field>
              <TitlesInput value={draft.titles} onChange={(titles) => setDraft({ ...draft, titles })} />
              <div className="flex gap-2">
                <Button type="submit" variant="primary" className="flex-1">Search</Button>
                <Button type="button" variant="secondary" onClick={reset}>Reset</Button>
              </div>
            </form>
          </Card>
        </aside>

        <section className="flex min-h-[28rem] min-w-0 flex-1 flex-col gap-3 lg:min-h-0" aria-label="Results">
          <Card className="flex min-h-0 flex-1 flex-col">
          {/* A slim ribbon in the table's top right corner: one line, so it costs almost no height. */}
          <div className="flex shrink-0 justify-end border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
            <p
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
              role="note"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 4h.01" />
              </svg>
              Reveal a contact&apos;s email address by adding it to your contacts. Each reveal costs 1 credit.
            </p>
          </div>
        {list.isError ? (
          <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : list.isPending ? (
          <div className="min-h-0 flex-1 overflow-y-auto"><LoadingRows cols={12} /></div>
        ) : (
          <>
            {/* The table scrolls on its own (both ways) with the header row pinned, like Apollo; the page and the filters stay put. */}
            <div className="min-h-0 flex-1 overflow-auto" tabIndex={0} aria-label="People results">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <Th>First Name</Th><Th>Last Name</Th><Th>Title</Th><Th>Company Name</Th><Th>Email</Th><Th># Employees</Th>
                  <Th>Industry</Th><Th>City</Th><Th>State</Th><Th>Country</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id} className="[&>td]:!py-1.5">
                    <Td className="font-medium">{p.firstName}</Td>
                    <Td className="font-medium">{p.lastName}</Td>
                    <Td className="max-w-[14rem] truncate">{p.title}</Td>
                    <Td className="whitespace-nowrap">{p.companyName}</Td>
                    <Td>
                      {p.email ? (
                        <span className="whitespace-nowrap">{p.email}</span>
                      ) : !p.hasEmail ? (
                        <span className="text-slate-400">No email</span>
                      ) : (
                        <Button
                          variant="primary"
                          className="cursor-pointer whitespace-nowrap !px-3 !py-1"
                          disabled={adding !== null || credits < 1}
                          title={credits < 1 ? "You are out of credits" : "Reveal the email address and add this person to your contacts (1 credit)"}
                          onClick={() => addContact(p)}
                        >
                          {adding === p.id ? "Adding..." : "Add Contact"}
                        </Button>
                      )}
                    </Td>
                    <Td className="tabular-nums">{p.employees === null ? "-" : fmt(p.employees)}</Td>
                    <Td>{p.industry}</Td>
                    <Td>{dash(p.city)}</Td>
                    <Td>{dash(p.state)}</Td>
                    <Td className="whitespace-nowrap">{p.country}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {list.data.items.length === 0 && <Empty>No people match these filters. Try removing one.</Empty>}
            {total > 0 && <div className="shrink-0"><Pagination page={page} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} onPage={setPage} /></div>}
          </>
        )}
          </Card>
        </section>
      </div>
    </div>
  );
}
