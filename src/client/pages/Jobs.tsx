import { useMemo, useState } from "react";
import { Badge, Button, Card, Empty, FillPage, PageHeader, Pagination, Table, TableCard, Td, Th, fmtDay } from "@/components/ui";
import { MultiSelect } from "@/components/MultiSelect";
import { JOBS, JOB_CATEGORIES, JOB_LOCATIONS, type Job } from "@/mock/jobs";

const PAGE_SIZE = 25;
const typeTone = { "Full-time": "green", "Part-time": "amber", Contract: "blue" } as const;

interface Filters { categories: string[]; locations: string[] }
const NONE: Filters = { categories: [], locations: [] };

/**
 * Jobs (dummy data for now): a list with a Category and a Location filter, in the app's table standard (fills the window, the
 * table scrolls on its own, the pager sits under it). Both filters take several values; a job matches when it is in ANY chosen
 * category and ANY chosen location, and an empty filter is not applied.
 */
export function Jobs() {
  const [draft, setDraft] = useState<Filters>(NONE);
  const [applied, setApplied] = useState<Filters>(NONE);
  const [page, setPage] = useState(1);

  const matches = useMemo<Job[]>(
    () => JOBS.filter((j) => (applied.categories.length === 0 || applied.categories.includes(j.category)) && (applied.locations.length === 0 || applied.locations.includes(j.location))),
    [applied],
  );
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = matches.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const apply = (e: React.FormEvent) => {
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
    <FillPage>
      <PageHeader title="Jobs" description="Browse jobs by category and location." />

      {/* relative + z-20: the open lists drop down over the table below */}
      <Card className="relative z-20 mb-3 shrink-0">
        <form onSubmit={apply} aria-label="Filter jobs" className="grid items-start gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <MultiSelect label="Category" options={JOB_CATEGORIES} value={draft.categories} onChange={(categories) => setDraft({ ...draft, categories })} placeholder="Search categories..." />
          <MultiSelect label="Location" options={JOB_LOCATIONS} value={draft.locations} onChange={(locations) => setDraft({ ...draft, locations })} placeholder="Search locations..." />
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1 lg:mt-[1.625rem]">
            <Button type="submit" variant="primary" className="flex-1">Search</Button>
            <Button type="button" variant="secondary" onClick={reset}>Reset</Button>
          </div>
        </form>
      </Card>

      <TableCard>
        <Table fill>
          <thead>
            <tr><Th>Job</Th><Th>Company</Th><Th>Category</Th><Th>Location</Th><Th>Type</Th><Th>Posted</Th></tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id}>
                <Td className="font-medium">{j.title}</Td>
                <Td className="whitespace-nowrap">{j.company}</Td>
                <Td className="whitespace-nowrap text-slate-600 dark:text-slate-300">{j.category}</Td>
                <Td className="whitespace-nowrap text-slate-600 dark:text-slate-300">{j.location}</Td>
                <Td><Badge tone={typeTone[j.type]}>{j.type}</Badge></Td>
                <Td className="whitespace-nowrap text-slate-600 dark:text-slate-300">{fmtDay(`${j.posted}T12:00:00`)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {matches.length === 0 && <Empty>No jobs match these filters. Try removing one.</Empty>}
        {matches.length > 0 && <Pagination page={current} pageCount={pageCount} total={matches.length} pageSize={PAGE_SIZE} onPage={setPage} />}
      </TableCard>
    </FillPage>
  );
}
