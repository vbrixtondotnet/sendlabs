// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Jobs } from "../../src/client/pages/Jobs";
import { postedAgo } from "../../src/client/lib/jobs";
import type { JobCompanyDto, JobDto } from "../../src/shared/api";
import { page, renderAt, stubApi, type Handler } from "./harness";

const job = (over: Partial<JobDto> = {}): JobDto => ({
  id: "j1", title: "Senior .NET Developer", companyName: "Acme Corp", companyLogo: "https://remotive.com/job/1/logo", category: "Software Development",
  employmentType: "Full-time", location: "Worldwide", salary: "$3,000-$5,000", skills: ["c#", ".net 8", "sql server", "azure"],
  url: "https://remotive.com/remote-jobs/software-dev/job-1", source: "Remotive", publishedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), ...over,
});
const company = (over: Partial<JobCompanyDto> = {}): JobCompanyDto => ({ name: "Acme Corp", logo: "https://remotive.com/job/1/logo", category: "Software Development", openPositions: 5, ...over });

const reply = (items: JobDto[], total = items.length, p = 1) => ({ json: page(items, total, p, 25) });
const base: Handler = ({ path }) =>
  path === "/api/jobs/categories" ? { json: { items: ["Design", "Software Development"] } }
  : path === "/api/jobs/locations" ? { json: { items: ["USA", "Worldwide"] } }
  : path === "/api/jobs/companies" ? { json: { items: [company(), company({ name: "Beta LLC", logo: "", category: "Design", openPositions: 1 })] } }
  : path === "/api/jobs" ? reply([job(), job({ id: "j2", title: "UI/UX Designer", companyName: "Beta LLC", companyLogo: "", employmentType: "Contract", salary: "", skills: ["figma"], url: "" })])
  : undefined;
const lastJobs = (calls: ReturnType<typeof stubApi>) => [...calls].reverse().find((c) => c.path === "/api/jobs");

/** Picks an option in one of the searchable multi-selects. */
function pick(name: string, option: RegExp) {
  const box = screen.getByRole("combobox", { name });
  fireEvent.focus(box);
  fireEvent.click(within(screen.getByRole("listbox", { name })).getByRole("option", { name: option }));
}

describe("Jobs page", () => {
  it("has the headline, the Job search panel and the Hiring Companies panel", async () => {
    stubApi(base);
    renderAt(<Jobs />);
    expect(screen.getByRole("heading", { name: "Find Your Next Opportunity" })).toBeTruthy();
    expect(screen.getByText("Discover remote jobs, freelance projects, and opportunities.")).toBeTruthy();
    const form = screen.getByRole("form", { name: "Job search" });
    expect(within(form).getByLabelText("Keyword")).toBeTruthy();
    expect(within(form).getByRole("combobox", { name: "Category" })).toBeTruthy();
    expect(within(form).getByRole("combobox", { name: "Location" })).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Search Jobs" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Hiring Companies" })).toBeTruthy();
    await screen.findByText("Senior .NET Developer");
  });

  it("lists the jobs the API returns as cards, with the count, and credits Remotive", async () => {
    stubApi(base);
    renderAt(<Jobs />);
    const card = (await screen.findByRole("article", { name: "Senior .NET Developer, Acme Corp" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Showing 2 jobs")).toBeTruthy();
    expect(within(card).getByText("Remote · Full-time · $3,000-$5,000")).toBeTruthy();
    expect(within(card).getByText("c# · .net 8 · sql server · azure")).toBeTruthy();
    expect(within(card).getByText("Posted 2 hours ago", { exact: false })).toBeTruthy();
    // Remotive's terms: it is named as the source and linked to the job on remotive.com
    expect(within(card).getByRole("link", { name: "Remotive" }).getAttribute("href")).toBe("https://remotive.com/remote-jobs/software-dev/job-1");
    expect(screen.getByRole("link", { name: /Remote jobs from Remotive/ }).getAttribute("href")).toBe("https://remotive.com");
  });

  it("Apply Now opens the job at its source in a new tab, safely; a job with no link cannot be applied to", async () => {
    stubApi(base);
    renderAt(<Jobs />);
    const apply = await screen.findByRole("link", { name: "Apply now: Senior .NET Developer" });
    expect(apply.textContent).toBe("Apply Now");
    expect(apply.getAttribute("href")).toBe("https://remotive.com/remote-jobs/software-dev/job-1");
    expect(apply.getAttribute("target")).toBe("_blank");
    expect(apply.getAttribute("rel")).toContain("noopener");
    expect((screen.getByRole("button", { name: "Apply now: UI/UX Designer" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends the search to the server only when Search Jobs is pressed", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />);
    await screen.findByText("Senior .NET Developer");
    expect(lastJobs(calls)!.query.get("pageSize")).toBe("25");
    const before = calls.length;

    fireEvent.change(screen.getByLabelText("Keyword"), { target: { value: "azure" } });
    await waitFor(() => expect(screen.getByRole("option", { name: /Design/, hidden: true }) ?? true).toBeTruthy()).catch(() => undefined);
    pick("Category", /Software Development/);
    pick("Location", /Worldwide/);
    expect(calls.length).toBe(before); // nothing sent yet

    fireEvent.click(screen.getByRole("button", { name: "Search Jobs" }));
    await waitFor(() => expect(lastJobs(calls)!.query.get("keyword")).toBe("azure"));
    const q = lastJobs(calls)!.query;
    expect(q.get("categories")).toBe("Software Development");
    expect(q.get("locations")).toBe("Worldwide");
    expect(q.get("page")).toBe("1");
  });

  it("pages on the server: the next page is a new request, and the total comes from the API", async () => {
    const calls = stubApi(({ path, query }) => (path === "/api/jobs" ? reply([job({ id: `p${query.get("page")}`, title: `Page${query.get("page")} job` })], 60, Number(query.get("page"))) : base({ path, query } as never)));
    renderAt(<Jobs />);
    expect(await screen.findByText("Page1 job")).toBeTruthy();
    expect(screen.getByText("Showing 60 jobs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page2 job")).toBeTruthy();
    expect(lastJobs(calls)!.query.get("page")).toBe("2");
  });

  it("says so when there are no jobs yet, and when a search finds none", async () => {
    stubApi(({ path, query }) => (path === "/api/jobs" ? reply([]) : base({ path, query } as never)));
    renderAt(<Jobs />);
    expect(await screen.findByText(/No jobs yet/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Keyword"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Jobs" }));
    expect(await screen.findByText(/No jobs match your search/)).toBeTruthy();
  });

  it("shows an error with a retry when the jobs cannot be loaded", async () => {
    stubApi(({ path, query }) => (path === "/api/jobs" ? { status: 500, json: { error: { code: "INTERNAL", message: "boom" } } } : base({ path, query } as never)));
    renderAt(<Jobs />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("Hiring Companies panel", () => {
  it("has a card per company from the API: Hiring now, name, category, open positions, View Company", async () => {
    stubApi(base);
    renderAt(<Jobs />);
    const panel = screen.getByRole("complementary", { name: "Hiring Companies" });
    const items = await within(panel).findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Hiring now")).toBeTruthy();
    expect(within(items[0]!).getByText("Acme Corp")).toBeTruthy();
    expect(within(items[0]!).getByText("Software Development")).toBeTruthy();
    expect(within(items[0]!).getByText("5 Open Positions")).toBeTruthy();
    expect(within(items[1]!).getByText("1 Open Position")).toBeTruthy();
    expect(within(items[0]!).getByRole("button", { name: "View Acme Corp" }).textContent).toBe("View Company");
  });

  it("View Company searches that company's jobs", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />);
    fireEvent.click(await screen.findByRole("button", { name: "View Beta LLC" }));
    await waitFor(() => expect(lastJobs(calls)!.query.get("keyword")).toBe("Beta LLC"));
    expect((screen.getByLabelText("Keyword") as HTMLInputElement).value).toBe("Beta LLC");
  });
});

describe("postedAgo", () => {
  const now = Date.UTC(2026, 10, 24, 12, 0, 0);
  const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  it("reads like a feed", () => {
    expect([0, 1, 2, 23, 24, 72, 24 * 7, 24 * 20, 24 * 30, 24 * 65].map((h) => postedAgo(ago(h), now))).toEqual([
      "Posted just now", "Posted 1 hour ago", "Posted 2 hours ago", "Posted 23 hours ago", "Posted 1 day ago", "Posted 3 days ago",
      "Posted 1 week ago", "Posted 2 weeks ago", "Posted 1 month ago", "Posted 2 months ago",
    ]);
    expect(postedAgo(null, now)).toBe("");
  });
});
