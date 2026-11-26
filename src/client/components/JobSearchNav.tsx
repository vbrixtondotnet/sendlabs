import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MultiSelect } from "@/components/MultiSelect";
import { Button, Select, TextInput } from "@/components/ui";
import { useJobCategories, useJobLocations } from "@/services/jobs";

/** The address of the Jobs page for a search: /jobs?q=...&category=...&location=A&location=B (empty parts left out). */
export function jobsSearchPath(f: { keyword: string; category: string; locations: string[] }): string {
  const p = new URLSearchParams();
  if (f.keyword.trim()) p.set("q", f.keyword.trim());
  if (f.category) p.set("category", f.category);
  for (const l of f.locations) p.append("location", l);
  const s = p.toString();
  return s ? `/jobs?${s}` : "/jobs";
}

/**
 * The job search in the left navigation, under Summary: Keyword, Category and Location. It is on every page, so a search can start anywhere;
 * Search Jobs opens the Jobs page with those filters. On the Jobs page it shows the filters in use.
 */
export function JobSearchNav({ onDone }: { onDone?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const categories = useJobCategories();
  const locations = useJobLocations();
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  // Following the address: on the Jobs page the fields show the search that is running (also after a reload or Back).
  useEffect(() => {
    if (location.pathname !== "/jobs") return;
    const p = new URLSearchParams(location.search);
    setKeyword(p.get("q") ?? "");
    setCategory(p.get("category") ?? "");
    setPicked(p.getAll("location"));
  }, [location.pathname, location.search]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(jobsSearchPath({ keyword, category, locations: picked }));
    onDone?.();
  };
  const reset = () => {
    setKeyword("");
    setCategory("");
    setPicked([]);
    navigate("/jobs");
    onDone?.();
  };

  return (
    <form onSubmit={submit} role="search" aria-label="Job search" className="space-y-3 px-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Search Jobs</h2>
      <div>
        <label htmlFor="nav-keyword" className="mb-1 block text-sm font-medium">Keyword</label>
        <TextInput id="nav-keyword" placeholder="Title, company or skill" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>
      <div>
        <label htmlFor="nav-category" className="mb-1 block text-sm font-medium">Category</label>
        <Select id="nav-category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.data?.items.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </div>
      <MultiSelect label="Location" options={locations.data?.items ?? []} value={picked} onChange={setPicked} placeholder="Search locations..." />
      <div className="flex gap-2">
        <Button type="submit" variant="primary">Search Jobs</Button>
        <Button type="button" variant="secondary" onClick={reset}>Reset</Button>
      </div>
    </form>
  );
}
