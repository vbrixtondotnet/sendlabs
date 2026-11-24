// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Jobs } from "../../src/client/pages/Jobs";
import { HIRING_COMPANIES } from "../../src/client/data/hiringCompanies";
import { postedAgo } from "../../src/client/lib/jobs";
import { safeApplyUrl } from "../../src/shared/jobs";
import type { JobDto } from "../../src/shared/api";
import { meDto, page, renderAt, senderStatus, stubApi, type Call, type Handler } from "./harness";

const job = (over: Partial<JobDto> = {}): JobDto => ({
  remote: true,
  id: "1", title: "Senior .NET Developer", companyName: "Acme Corp", companyLogo: "https://remotive.com/job/1/logo", category: "Software Development",
  employmentType: "Full-time", location: "Worldwide", salary: "$3,000-$5,000", skills: ["c#", ".net 8", "sql server", "azure"],
  url: "https://remotive.com/remote-jobs/software-dev/job-1", source: "Remotive", publishedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), ...over,
});

const reply = (items: JobDto[], total = items.length, p = 1, unavailable: string[] = []) => ({ json: { ...page(items, total, p, 25), unavailable } });
const side = (path: string) =>
  path === "/api/jobs/categories" ? { json: { items: [{ value: "software-dev", label: "Software Development" }, { value: "design", label: "Design" }] } }
  : path === "/api/jobs/locations" ? { json: { items: ["USA", "Worldwide"] } }
  : undefined;
const base: Handler = ({ path }) => side(path) ?? (path === "/api/jobs" ? reply([job(), job({ id: "2", title: "UI/UX Designer", companyName: "Beta LLC", companyLogo: "", employmentType: "Contract", salary: "", location: "", skills: ["figma"], url: "" })]) : undefined);
const jobCalls = (calls: Call[]) => calls.filter((c) => c.path === "/api/jobs");
const lastJobs = (calls: Call[]) => jobCalls(calls).at(-1)!;

describe("Jobs page: the live list", () => {
  it("keeps the design: headline, Job search panel, job cards and the Hiring Companies panel", async () => {
    stubApi(base);
    renderAt(<Jobs />);
    expect(screen.getByRole("heading", { name: "Find Your Next Opportunity" })).toBeTruthy();
    const form = screen.getByRole("form", { name: "Job search" });
    expect(within(form).getByLabelText("Keyword")).toBeTruthy();
    expect(within(form).getByLabelText("Category")).toBeTruthy();
    expect(within(form).getByRole("combobox", { name: "Location" })).toBeTruthy();
    expect(within(form).getByLabelText("Remote only")).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Search Jobs" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Hiring Companies" })).toBeTruthy();
    expect(await screen.findByRole("article", { name: "Senior .NET Developer, Acme Corp" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("loads the first page of jobs on open, with skeleton cards until they arrive", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />);
    expect(screen.getByRole("status", { name: "Loading jobs" })).toBeTruthy(); // skeletons
    await screen.findByText("Senior .NET Developer");
    expect(screen.queryByRole("status", { name: "Loading jobs" })).toBeNull();
    expect(jobCalls(calls)).toHaveLength(1);
    expect(lastJobs(calls).query.get("pageSize")).toBe("25");
    expect(lastJobs(calls).query.get("sort")).toBe("newest");
    expect(screen.getByText("Showing 2 jobs")).toBeTruthy();
  });

  it("shows on a card the title, company, kind / pay, where from, skills, how long ago, and credits Remotive", async () => {
    stubApi(base);
    renderAt(<Jobs />);
    const card = await screen.findByRole("article", { name: "Senior .NET Developer, Acme Corp" });
    expect(within(card).getByText("Remote · Full-time · $3,000-$5,000")).toBeTruthy();
    expect(within(card).getByText("Candidates from: Worldwide")).toBeTruthy();
    expect(within(card).getByText("c# · .net 8 · sql server · azure")).toBeTruthy();
    expect(within(card).getByText(/Posted 2 hours ago/)).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Remotive" }).getAttribute("href")).toBe("https://remotive.com/remote-jobs/software-dev/job-1");
    expect(screen.queryByText(/Jobs from/)).toBeNull(); // no source line in the header: each card names and links its own source
  });

  it("copes with a missing logo, salary, location and link", async () => {
    stubApi(base);
    renderAt(<Jobs />);
    const card = await screen.findByRole("article", { name: "UI/UX Designer, Beta LLC" });
    expect(within(card).getByText("Remote · Contract")).toBeTruthy(); // no salary
    expect(within(card).queryByText(/Candidates from/)).toBeNull(); // no location
    expect(card.querySelector("img")).toBeNull(); // no logo
  });

  it("Apply Now opens the email panel instead of the job's link", async () => {
    stubApi(({ path }) => side(path) ?? (path === "/api/me" ? { json: meDto() } : path === "/api/sender" ? { json: senderStatus() } : path === "/api/jobs" ? reply([job()]) : undefined));
    renderAt(<Jobs />);
    const apply = await screen.findByRole("button", { name: "Apply now: Senior .NET Developer" });
    expect(apply.tagName).toBe("BUTTON"); // not a link: pressing it does not leave the page
    expect(apply.textContent).toBe("Apply Now");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(apply);
    const panel = await screen.findByRole("dialog", { name: "Apply by email" });
    expect(within(panel).getByText("Senior .NET Developer · Acme Corp")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Close panel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("checks a job's link before it can be drawn: only https on a job source's own site", () => {
    expect(safeApplyUrl("javascript:alert(1)")).toBe("");
    expect(safeApplyUrl("http://remotive.com/x")).toBe("");
    expect(safeApplyUrl("https://jobs.remotive.com/x")).toBe("https://jobs.remotive.com/x");
    expect(safeApplyUrl("https://evil.example/remotive.com")).toBe("");
  });
});

describe("Jobs page: both sources in one list", () => {
  const berlin = job({ id: "arbeitnow:berlin", title: "Backend Engineer", companyName: "Tulip", companyLogo: "", category: "Engineering", remote: false, location: "Berlin", salary: "", skills: ["Engineering"], source: "Arbeitnow", url: "https://www.arbeitnow.com/jobs/companies/tulip/berlin" });
  const remoteArb = job({ id: "arbeitnow:r", title: "Sales Lead", companyName: "Gamma", companyLogo: "", remote: true, location: "Paris", salary: "", skills: ["Sales"], source: "Arbeitnow", url: "https://www.arbeitnow.com/jobs/companies/gamma/r" });
  const mixed: Handler = ({ path }) => side(path) ?? (path === "/api/jobs" ? reply([job(), berlin, remoteArb]) : undefined);

  it("shows Remotive and Arbeitnow jobs as the same kind of card; Remotive's credits and links Remotive, Arbeitnow's has no link on the card", async () => {
    stubApi(mixed);
    renderAt(<Jobs />);
    const rem = await screen.findByRole("article", { name: "Senior .NET Developer, Acme Corp" });
    const arbCard = screen.getByRole("article", { name: "Backend Engineer, Tulip" });
    expect(within(rem).getByRole("link", { name: "Remotive" }).getAttribute("href")).toBe("https://remotive.com/remote-jobs/software-dev/job-1");
    expect(within(arbCard).queryByText(/via/)).toBeNull(); // Arbeitnow jobs carry no "via" line
    expect(within(arbCard).queryByRole("link")).toBeNull();
    expect(within(arbCard).getByRole("button", { name: "Apply now: Backend Engineer" })).toBeTruthy();
    expect(screen.getByText("Showing 3 jobs")).toBeTruthy();
  });

  it("says Remote for a remote job and the place for an on-site one, and where the person is based when it is remote on Arbeitnow", async () => {
    stubApi(mixed);
    renderAt(<Jobs />);
    expect(within(await screen.findByRole("article", { name: "Senior .NET Developer, Acme Corp" })).getByText("Remote · Full-time · $3,000-$5,000")).toBeTruthy();
    const onsite = screen.getByRole("article", { name: "Backend Engineer, Tulip" });
    expect(within(onsite).getByText("Berlin · Full-time")).toBeTruthy();
    expect(within(onsite).queryByText(/Candidates from|Based in/)).toBeNull();
    const remoteOnArbeitnow = screen.getByRole("article", { name: "Sales Lead, Gamma" });
    expect(within(remoteOnArbeitnow).getByText("Remote · Full-time")).toBeTruthy();
    expect(within(remoteOnArbeitnow).getByText("Based in: Paris")).toBeTruthy();
  });

  it("when one source cannot be reached, still shows the other's jobs and says which one is missing", async () => {
    stubApi(({ path }) => side(path) ?? (path === "/api/jobs" ? reply([job()], 1, 1, ["Arbeitnow"]) : undefined));
    renderAt(<Jobs />);
    expect(await screen.findByText("Senior .NET Developer")).toBeTruthy();
    expect(screen.getByText("Arbeitnow could not be reached")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("Jobs page: filters", () => {
  it("sends the keyword once, after the person stops typing (not for every letter)", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />);
    await screen.findByText("Senior .NET Developer");
    const box = screen.getByLabelText("Keyword");
    for (const v of ["r", "re", "rea", "reac", "react"]) fireEvent.change(box, { target: { value: v } });
    expect(jobCalls(calls)).toHaveLength(1); // nothing sent while typing
    await waitFor(() => expect(lastJobs(calls).query.get("keyword")).toBe("react"), { timeout: 3000 });
    expect(jobCalls(calls)).toHaveLength(2); // one request for the whole word
    expect(lastJobs(calls).query.get("page")).toBe("1");
  });

  it("Search Jobs sends the keyword at once", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />);
    await screen.findByText("Senior .NET Developer");
    fireEvent.change(screen.getByLabelText("Keyword"), { target: { value: "azure" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Jobs" }));
    await waitFor(() => expect(lastJobs(calls).query.get("keyword")).toBe("azure"), { timeout: 500 });
  });

  it("sends category, locations, Remote only and the sort as soon as they are chosen", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />);
    await screen.findByText("Senior .NET Developer");
    await screen.findByRole("option", { name: "Software Development" }); // categories come from the API
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "software-dev" } });
    await waitFor(() => expect(lastJobs(calls).query.get("category")).toBe("software-dev"));

    const loc = screen.getByRole("combobox", { name: "Location" });
    fireEvent.focus(loc);
    fireEvent.click(await within(await screen.findByRole("listbox", { name: "Location" })).findByRole("option", { name: /USA/ }));
    await waitFor(() => expect(lastJobs(calls).query.get("locations")).toBe("USA"));

    fireEvent.click(screen.getByLabelText("Remote only"));
    await waitFor(() => expect(lastJobs(calls).query.get("remoteOnly")).toBe("true"));

    fireEvent.change(screen.getByLabelText("Sort by publication date"), { target: { value: "oldest" } });
    await waitFor(() => expect(lastJobs(calls).query.get("sort")).toBe("oldest"));
    expect(lastJobs(calls).query.get("page")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(lastJobs(calls).query.get("category")).toBeNull());
    expect(lastJobs(calls).query.get("remoteOnly")).toBeNull();
  });

  it("pages on the server: the next page is a new request, and the total comes from the API", async () => {
    const calls = stubApi(({ path, query }) => side(path) ?? (path === "/api/jobs" ? reply([job({ id: `p${query.get("page")}`, title: `Page${query.get("page")} job` })], 60, Number(query.get("page"))) : undefined));
    renderAt(<Jobs />);
    expect(await screen.findByText("Page1 job")).toBeTruthy();
    expect(screen.getByText("Showing 60 jobs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page2 job")).toBeTruthy();
    expect(lastJobs(calls).query.get("page")).toBe("2");
  });
});

describe("Jobs page: empty and error states", () => {
  it("says so when there are no jobs, and when the filters find none", async () => {
    stubApi(({ path }) => side(path) ?? (path === "/api/jobs" ? reply([]) : undefined));
    renderAt(<Jobs />);
    expect(await screen.findByText(/No jobs are available right now/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remote only"));
    expect(await screen.findByText(/No jobs match your filters/)).toBeTruthy();
  });

  it("shows an error with Try again when Remotive is unavailable at the start, and Try again loads the jobs", async () => {
    let up = false;
    const calls = stubApi(({ path }) => side(path) ?? (path === "/api/jobs" ? (up ? reply([job()]) : { status: 502, json: { error: { code: "JOB_SOURCE_UNAVAILABLE", message: "Remotive answered 500" } } }) : undefined));
    renderAt(<Jobs />);
    expect(await screen.findByText("Remotive answered 500")).toBeTruthy();
    up = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Senior .NET Developer")).toBeTruthy();
    expect(jobCalls(calls)).toHaveLength(2);
  });

  it("keeps the jobs on screen when a later search fails, says so, and Try again recovers", async () => {
    let failing = false;
    stubApi(({ path, query }) => side(path) ?? (path === "/api/jobs" ? (failing && query.get("keyword") ? { status: 504, json: { error: { code: "JOB_SOURCE_UNAVAILABLE", message: "Remotive did not answer" } } } : reply([job()])) : undefined));
    renderAt(<Jobs />);
    await screen.findByText("Senior .NET Developer");
    failing = true;
    fireEvent.change(screen.getByLabelText("Keyword"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Jobs" }));
    expect(await screen.findByText("Could not refresh the jobs")).toBeTruthy();
    expect(screen.getByText("Senior .NET Developer")).toBeTruthy(); // still there
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("Could not refresh the jobs")).toBeNull());
  });
});

describe("Hiring Companies panel", () => {
  it("is a fixed list that does not depend on the Remotive results", async () => {
    const calls = stubApi(({ path, query }) => side(path) ?? (path === "/api/jobs" ? (query.get("keyword") ? reply([]) : reply([job()])) : undefined));
    renderAt(<Jobs />);
    const panel = screen.getByRole("complementary", { name: "Hiring Companies" });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(HIRING_COMPANIES.length);
    expect(calls.map((c) => c.path).filter((p) => /compan/.test(p))).toEqual([]); // it asks the server for nothing
    await screen.findByText("Senior .NET Developer");
    fireEvent.change(screen.getByLabelText("Keyword"), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Jobs" }));
    await screen.findByText(/No jobs match your filters/);
    expect(within(panel).getAllByRole("listitem")).toHaveLength(HIRING_COMPANIES.length); // unchanged by an empty result
  });

  it("has a card per company: Hiring now, name, industry, a line about it, open positions, View Company", () => {
    stubApi(base);
    renderAt(<Jobs />);
    const first = HIRING_COMPANIES[0]!;
    const item = within(screen.getByRole("complementary", { name: "Hiring Companies" })).getAllByRole("listitem")[0]!;
    expect(within(item).getByText("Hiring now")).toBeTruthy();
    expect(within(item).getByText(first.name)).toBeTruthy();
    expect(within(item).getByText(first.industry)).toBeTruthy();
    expect(within(item).getByText(first.blurb)).toBeTruthy();
    expect(within(item).getByText(`${first.openPositions} Open Positions`)).toBeTruthy();
    expect(within(item).getByRole("button", { name: `View ${first.name}` }).textContent).toBe("View Company");
  });

  it("View Company searches the jobs for that company", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />);
    await screen.findByText("Senior .NET Developer");
    fireEvent.click(screen.getByRole("button", { name: `View ${HIRING_COMPANIES[2]!.name}` }));
    await waitFor(() => expect(lastJobs(calls).query.get("keyword")).toBe(HIRING_COMPANIES[2]!.name), { timeout: 500 });
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
