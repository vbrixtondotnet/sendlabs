import { useState } from "react";
import { PEOPLE_COMPANY_SIZES, PEOPLE_COUNTRIES, PEOPLE_INDUSTRIES, PEOPLE_MAX_TITLES } from "@shared/people";
import { Button, Card, Empty, ErrorNotice, Field, LoadingRows, Notice, PageHeader, Pagination, Select, Td, Th, fmt } from "@/components/ui";
import { MultiSelect } from "@/components/MultiSelect";
import { useToast } from "@/hooks/useToast";
import { usePeopleSearch, type PeopleFilters } from "@/services/people";

const PAGE_SIZE = 25;
const NONE: PeopleFilters = { countries: [], industry: "", companySize: "", titles: [] };

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
    <div className="flex h-[calc(100vh-8rem)] min-h-[28rem] flex-col">
      <PageHeader title="People" description="Find people to reach out to, by country, industry, company size and job title." />
      <div className="mb-4 shrink-0">
        <Notice tone="info" title="Reveal a person's email address">
          Email addresses are hidden until you reveal them. Click <strong>Add Contact</strong> next to a person to reveal their email address for <strong>1 credit</strong>.
        </Notice>
      </div>
      <Card className="flex min-h-0 flex-1 flex-col">
        <form onSubmit={search} className="shrink-0 space-y-4 border-b border-slate-200 p-4 dark:border-slate-800" aria-label="Search people">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MultiSelect label="Country" options={PEOPLE_COUNTRIES} value={draft.countries} onChange={(countries) => setDraft({ ...draft, countries })} placeholder="Search countries..." />
            <Field label="Industry" htmlFor="people-industry">
              <Select id="people-industry" value={draft.industry} onChange={(e) => setDraft({ ...draft, industry: e.target.value })}>
                <option value="">Any industry</option>
                {PEOPLE_INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
              </Select>
            </Field>
            <Field label="Company size" htmlFor="people-size">
              <Select id="people-size" value={draft.companySize} onChange={(e) => setDraft({ ...draft, companySize: e.target.value })}>
                <option value="">Any size</option>
                {PEOPLE_COMPANY_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label} employees</option>)}
              </Select>
            </Field>
            <TitlesInput value={draft.titles} onChange={(titles) => setDraft({ ...draft, titles })} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary">Search</Button>
            <Button type="button" variant="secondary" onClick={reset}>Reset</Button>
          </div>
        </form>

        {list.isError ? (
          <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : list.isPending ? (
          <div className="min-h-0 flex-1 overflow-y-auto"><LoadingRows cols={12} /></div>
        ) : (
          <>
            <p className="shrink-0 px-4 pt-3 text-sm text-slate-600 dark:text-slate-400" role="status">{fmt(total)} {total === 1 ? "person" : "people"} found</p>
            {/* The table scrolls on its own (both ways) with the header row pinned, like Apollo; the page and the filters stay put. */}
            <div className="min-h-0 flex-1 overflow-auto" tabIndex={0} aria-label="People results">
            <table className="w-full min-w-[1250px] text-left text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <Th>First Name</Th><Th>Last Name</Th><Th>Title</Th><Th>Company Name</Th><Th>Email</Th><Th># Employees</Th>
                  <Th>Industry</Th><Th>Website</Th><Th>City</Th><Th>State</Th><Th>Country</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-medium">{p.firstName}</Td>
                    <Td className="font-medium">{p.lastName}</Td>
                    <Td className="max-w-[14rem] truncate">{p.title}</Td>
                    <Td className="whitespace-nowrap">{p.companyName}</Td>
                    <Td>
                      <Button variant="primary" className="whitespace-nowrap !px-3 !py-1" onClick={() => toast(`Adding ${p.firstName} ${p.lastName} will be available once Apollo is connected.`, "info")}>
                        Add Contact
                      </Button>
                    </Td>
                    <Td className="tabular-nums">{fmt(p.employees)}</Td>
                    <Td>{p.industry}</Td>
                    <Td><a className="text-brand-600 hover:underline dark:text-brand-400" href={p.website} target="_blank" rel="noopener noreferrer">{p.website.replace(/^https?:\/\//, "")}</a></Td>
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
    </div>
  );
}
