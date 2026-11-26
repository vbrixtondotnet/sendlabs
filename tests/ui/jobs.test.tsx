// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Jobs } from "../../src/client/pages/Jobs";
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
  : path === "/api/jobs/companies" ? { json: { items: COMPANIES, total: COMPANIES.length, unavailable: [] } }
  : path === "/api/me" ? { json: meDto() }
  : undefined;
/** What the server says is hiring in the current results. */
const COMPANIES = [
  { name: "Acme Corp", logo: "", industry: "Software Development", openPositions: 12, sampleTitles: ["Senior .NET Developer", "QA Engineer"] },
  { name: "Beta LLC", logo: "", industry: "Design", openPositions: 1, sampleTitles: ["UI/UX Designer"] },
];
const companyCalls = (calls: Call[]) => calls.filter((c) => c.path === "/api/jobs/companies");
const base: Handler = ({ path }) => side(path) ?? (path === "/api/jobs" ? reply([job(), job({ id: "2", title: "UI/UX Designer", companyName: "Beta LLC", companyLogo: "", employmentType: "Contract", salary: "", location: "", skills: ["figma"], url: "" })]) : undefined);
const jobCalls = (calls: Call[]) => calls.filter((c) => c.path === "/api/jobs");
const lastJobs = (calls: Call[]) => jobCalls(calls).at(-1)!;

describe("Jobs page: the live list", () => {
  it("keeps the design: headline, results bar, job cards and the Hiring Companies panel", async () => {
    stubApi(base);
    renderAt(<Jobs />);
    expect(screen.getByRole("heading", { name: "Find Your Next Opportunity" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Job search" })).toBeNull(); // the search fields live in the left navigation now
    expect(screen.getByLabelText("Remote only")).toBeTruthy();
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
    expect(within(card).queryByText(/via/)).toBeNull(); // no "via Remotive" on a card
    expect(within(card).queryByRole("link")).toBeNull();
    expect(screen.queryByText(/Jobs from/)).toBeNull(); // and no source line in the header either
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
    const panel = await screen.findByRole("dialog", { name: "Apply By Email" });
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

describe("Jobs page: View Job", () => {
  const described: Handler = ({ path, query }) =>
    side(path)
    ?? (path === "/api/me" ? { json: meDto() } : path === "/api/sender" ? { json: senderStatus() } : undefined)
    ?? (path === "/api/jobs/description"
      ? { json: { id: query.get("id"), blocks: [{ type: "heading", text: "About the role" }, { type: "paragraph", text: "You will build great things." }, { type: "list", ordered: false, items: ["React", "Node"] }, { type: "list", ordered: true, items: ["Apply", "Interview"] }] } }
      : path === "/api/jobs" ? reply([job(), job({ id: "2", title: "UI/UX Designer", companyName: "Beta LLC", source: "Arbeitnow", url: "https://www.arbeitnow.com/jobs/companies/beta/x" })]) : undefined);

  it("puts a View Job button at the left of Apply Now on every card", async () => {
    stubApi(described);
    renderAt(<Jobs />);
    const card = await screen.findByRole("article", { name: "Senior .NET Developer, Acme Corp" });
    const buttons = within(card).getAllByRole("button").filter((b) => !/^Share on /.test(b.getAttribute("aria-label") ?? "")); // the share buttons are tested in share.test.tsx
    const names = buttons.map((b) => b.textContent);
    expect(names).toEqual(["View Job", "Apply Now"]);
    expect(within(card).getByText("Share this job and earn 1 Credit")).toBeTruthy();
    expect(buttons[0]!.compareDocumentPosition(buttons[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // View Job comes first
    expect(buttons[0]!.parentElement).toBe(buttons[1]!.parentElement); // side by side
  });

  it("opens a panel with the job's title and description, loaded for that job", async () => {
    const calls = stubApi(described);
    renderAt(<Jobs />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "View job: Senior .NET Developer" }));
    const panel = await screen.findByRole("dialog", { name: "Senior .NET Developer" });
    expect(panel.className).toContain("slide-in-right");
    expect(within(panel).getByText("Acme Corp")).toBeTruthy();
    expect(within(panel).getByText("Remote · Full-time · $3,000-$5,000")).toBeTruthy();
    expect(await within(panel).findByText("You will build great things.")).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "About the role" })).toBeTruthy();
    expect(within(panel).getAllByRole("list")[0]!.tagName).toBe("UL");
    expect(within(panel).getAllByRole("list")[1]!.tagName).toBe("OL");
    expect(within(panel).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["React", "Node", "Apply", "Interview"]);
    expect(calls.find((c) => c.path === "/api/jobs/description")!.query.get("id")).toBe("1");
  });

  it("shows a placeholder while the description loads, and an error with Try again if it cannot", async () => {
    let up = false;
    const calls = stubApi((call) => (call.path === "/api/jobs/description" ? (up ? described(call) : { status: 502, json: { error: { code: "JOB_SOURCE_UNAVAILABLE", message: "Remotive answered 500" } } }) : described(call)));
    renderAt(<Jobs />);
    fireEvent.click(await screen.findByRole("button", { name: "View job: Senior .NET Developer" }));
    const panel = await screen.findByRole("dialog", { name: "Senior .NET Developer" });
    expect(within(panel).getByRole("status", { name: "Loading the description" })).toBeTruthy();
    expect(await within(panel).findByText("Remotive answered 500")).toBeTruthy();
    up = true;
    fireEvent.click(within(panel).getByRole("button", { name: "Try again" }));
    expect(await within(panel).findByText("You will build great things.")).toBeTruthy();
    expect(calls.filter((c) => c.path === "/api/jobs/description")).toHaveLength(2);
  });

  it("says so when a job has no description", async () => {
    stubApi((call) => (call.path === "/api/jobs/description" ? { json: { id: "1", blocks: [] } } : described(call)));
    renderAt(<Jobs />);
    fireEvent.click(await screen.findByRole("button", { name: "View job: Senior .NET Developer" }));
    expect(await screen.findByText("This job has no description.")).toBeTruthy();
  });

  it("has an Apply Now button inside, which closes the panel and opens the email panel for the same job", async () => {
    stubApi(described);
    renderAt(<Jobs />);
    fireEvent.click(await screen.findByRole("button", { name: "View job: Senior .NET Developer" }));
    const view = await screen.findByRole("dialog", { name: "Senior .NET Developer" });
    fireEvent.click(within(view).getByRole("button", { name: "Apply now: Senior .NET Developer" }));
    const apply = await screen.findByRole("dialog", { name: "Apply By Email" });
    expect(within(apply).getByText("Senior .NET Developer · Acme Corp")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Senior .NET Developer" })).toBeNull(); // the description panel is on its way out (hidden at once)
    await waitFor(() => expect(document.querySelectorAll("aside[role=dialog]")).toHaveLength(1), { timeout: 1500 });
  });

  it("closes with the X, Escape or a click on the dimmed page, sliding out", async () => {
    stubApi(described);
    renderAt(<Jobs />);
    fireEvent.click(await screen.findByRole("button", { name: "View job: Senior .NET Developer" }));
    const panel = await screen.findByRole("dialog", { name: "Senior .NET Developer" });
    fireEvent.click(within(panel).getByRole("button", { name: "Close panel" }));
    expect(document.querySelector("aside[role=dialog]")!.className).toContain("slide-out-right");
    await waitFor(() => expect(document.querySelector("aside[role=dialog]")).toBeNull(), { timeout: 1500 });
    fireEvent.click(screen.getByRole("button", { name: "View job: Senior .NET Developer" }));
    await screen.findByRole("dialog", { name: "Senior .NET Developer" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.querySelector("aside[role=dialog]")).toBeNull(), { timeout: 1500 });
  });

  it("shows the company's logo in the panel header, and nothing when the job has none", async () => {
    stubApi((c) => (c.path === "/api/jobs" ? reply([job(), job({ id: "2", title: "UI/UX Designer", companyName: "Beta LLC", companyLogo: "" })]) : described(c)));
    renderAt(<Jobs />);
    fireEvent.click(await screen.findByRole("button", { name: "View job: Senior .NET Developer" }));
    const panel = await screen.findByRole("dialog", { name: "Senior .NET Developer" });
    expect(within(panel).getByRole("img", { name: "Acme Corp logo" }).getAttribute("src")).toBe("https://remotive.com/job/1/logo");
    fireEvent.click(within(panel).getByRole("button", { name: "Close panel" }));
    await waitFor(() => expect(document.querySelector("aside[role=dialog]")).toBeNull(), { timeout: 1500 });
    fireEvent.click(screen.getByRole("button", { name: "View job: UI/UX Designer" }));
    const other = await screen.findByRole("dialog", { name: "UI/UX Designer" });
    expect(within(other).queryByRole("img")).toBeNull();
  });

  it("never shows where or when the job was posted: no \"Posted ... via ...\" line, no source link, and no \"Originally posted on ...\" note", async () => {
    stubApi(({ path, query }) => (path === "/api/jobs/description"
      ? { json: { id: query.get("id"), blocks: [{ type: "paragraph", text: "You will build great things." }, { type: "paragraph", text: "Originally posted on Himalayas" }, { type: "paragraph", text: "Posted 1 month ago via Himalayas" }] } }
      : described({ path, query } as Call)));
    renderAt(<Jobs />);
    fireEvent.click(await screen.findByRole("button", { name: "View job: Senior .NET Developer" }));
    const panel = await screen.findByRole("dialog", { name: "Senior .NET Developer" });
    expect(await within(panel).findByText("You will build great things.")).toBeTruthy();
    expect(within(panel).queryByText(/Originally posted/i)).toBeNull();
    expect(within(panel).queryByText(/Posted .* ago/i)).toBeNull();
    expect(within(panel).queryByText(/via /i)).toBeNull();
    expect(within(panel).queryByRole("link")).toBeNull();
  });
});

describe("Jobs page: both sources in one list", () => {
  const berlin = job({ id: "arbeitnow:berlin", title: "Backend Engineer", companyName: "Tulip", companyLogo: "", category: "Engineering", remote: false, location: "Berlin", salary: "", skills: ["Engineering"], source: "Arbeitnow", url: "https://www.arbeitnow.com/jobs/companies/tulip/berlin" });
  const remoteArb = job({ id: "arbeitnow:r", title: "Sales Lead", companyName: "Gamma", companyLogo: "", remote: true, location: "Paris", salary: "", skills: ["Sales"], source: "Arbeitnow", url: "https://www.arbeitnow.com/jobs/companies/gamma/r" });
  const mixed: Handler = ({ path }) => side(path) ?? (path === "/api/jobs" ? reply([job(), berlin, remoteArb]) : undefined);

  it("shows Remotive and Arbeitnow jobs as the same kind of card, with no source line and no link on the card", async () => {
    stubApi(mixed);
    renderAt(<Jobs />);
    const rem = await screen.findByRole("article", { name: "Senior .NET Developer, Acme Corp" });
    const arbCard = screen.getByRole("article", { name: "Backend Engineer, Tulip" });
    expect(within(rem).queryByText(/via/)).toBeNull(); // neither source is named on a card
    expect(within(rem).queryByRole("link")).toBeNull();
    expect(within(arbCard).queryByText(/via/)).toBeNull();
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
  it("searches for the keyword, category and locations in the address (what the left navigation sends)", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />, { path: "/jobs?q=react&category=design&location=USA&location=Worldwide", route: "/jobs" });
    await screen.findByText("Senior .NET Developer");
    const q = lastJobs(calls).query;
    expect(q.get("keyword")).toBe("react");
    expect(q.get("category")).toBe("design");
    expect(q.get("locations")).toBe("USA,Worldwide");
    expect(q.get("page")).toBe("1");
    expect(jobCalls(calls)).toHaveLength(1); // one request, not one per filter
  });

  it("sends Remote only and the sort as soon as they are chosen", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />);
    await screen.findByText("Senior .NET Developer");
    fireEvent.click(screen.getByLabelText("Remote only"));
    await waitFor(() => expect(lastJobs(calls).query.get("remoteOnly")).toBe("true"));
    fireEvent.change(screen.getByLabelText("Sort by publication date"), { target: { value: "oldest" } });
    await waitFor(() => expect(lastJobs(calls).query.get("sort")).toBe("oldest"));
    expect(lastJobs(calls).query.get("page")).toBe("1");
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
    stubApi(({ path, query }) => side(path) ?? (path === "/api/jobs" ? (failing && query.get("remoteOnly") ? { status: 504, json: { error: { code: "JOB_SOURCE_UNAVAILABLE", message: "Remotive did not answer" } } } : reply([job()])) : undefined));
    renderAt(<Jobs />);
    await screen.findByText("Senior .NET Developer");
    failing = true;
    fireEvent.click(screen.getByLabelText("Remote only"));
    expect(await screen.findByText("Could not refresh the jobs")).toBeTruthy();
    expect(screen.getByText("Senior .NET Developer")).toBeTruthy(); // still there
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("Could not refresh the jobs")).toBeNull());
  });
});

describe("Hiring Companies panel", () => {
  const panel = () => screen.getByRole("complementary", { name: "Hiring Companies" });

  it("lists the companies the server found in the current results, busiest first, with their job counts", async () => {
    stubApi(base);
    renderAt(<Jobs />);
    expect(screen.getByRole("status", { name: "Loading companies" })).toBeTruthy();
    await within(panel()).findByText("Acme Corp");
    const items = within(panel()).getAllByRole("listitem");
    expect(items).toHaveLength(COMPANIES.length);
    const first = items[0]!;
    expect(within(first).getByText(/Software Development/)).toBeTruthy();
    expect(within(first).getByText("Senior .NET Developer \u00b7 QA Engineer")).toBeTruthy();
    expect(within(first).getByText("12 Open Positions")).toBeTruthy();
    expect(within(items[1]!).getByText("1 Open Position")).toBeTruthy();
    // exactly two buttons per card
    expect(within(first).getAllByRole("button").map((b) => b.textContent)).toEqual(["Show All Jobs", "Add to Contacts"]);
    expect(within(first).getByRole("button", { name: "Show all jobs at Acme Corp" })).toBeTruthy();
  });

  it("keeps each item short: no tall banner, so more companies fit", async () => {
    stubApi(base);
    renderAt(<Jobs />);
    await within(panel()).findByText("Acme Corp");
    const card = within(panel()).getAllByRole("listitem")[0]!;
    expect(card.querySelector('[style*="height"]')).toBeNull();
    expect(card.className).not.toMatch(/\bh-(2[4-9]|[3-9]\d)\b/);
    expect(card.querySelector(".h-24")).toBeNull();
    expect(within(card).queryByText("Hiring now")).toBeNull();
  });

  it("follows the search: it asks again with the keyword, category, locations and Remote only (not the company)", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />, { path: "/jobs?category=design", route: "/jobs" });
    await within(panel()).findByText("Acme Corp");
    expect(companyCalls(calls)).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Remote only"));
    await waitFor(() => expect(companyCalls(calls).length).toBeGreaterThan(1));
    const last = companyCalls(calls).at(-1)!;
    expect(last.query.get("category")).toBe("design");
    expect(last.query.get("remoteOnly")).toBe("true");
    expect(last.query.get("company")).toBeNull();
  });

  it("says plainly when no company is hiring for the search", async () => {
    stubApi(({ path, query }) => (path === "/api/jobs/companies" ? { json: { items: [], total: 0, unavailable: [] } } : base({ path, query } as Call)));
    renderAt(<Jobs />);
    expect(await within(panel()).findByText("No companies are hiring for this search.")).toBeTruthy();
  });

  it("Show All Jobs shows exactly that company's jobs (a company filter, not a keyword), and the card says it is showing", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />);
    await screen.findByText("Senior .NET Developer");
    fireEvent.click(await within(panel()).findByRole("button", { name: "Show all jobs at Acme Corp" }));
    await waitFor(() => expect(lastJobs(calls).query.get("company")).toBe("Acme Corp"));
    expect(lastJobs(calls).query.get("keyword")).toBeNull(); // the Keyword box is untouched
    expect(await within(panel()).findByRole("button", { name: /Show all jobs, not only Acme Corp/ })).toBeTruthy(); // the card now offers Clear Filter
    expect(screen.getByRole("button", { name: "Remove the Acme Corp filter" })).toBeTruthy();
    // the panel did not ask again with the company, so it keeps offering the others
    expect(companyCalls(calls).every((c) => c.query.get("company") === null)).toBe(true);
    expect(within(panel()).getByText("Beta LLC")).toBeTruthy();
  });

  it("Clear Filter and the chip's remove button clear the company again", async () => {
    const calls = stubApi(base);
    renderAt(<Jobs />);
    await screen.findByText("Senior .NET Developer");
    fireEvent.click(await within(panel()).findByRole("button", { name: "Show all jobs at Acme Corp" }));
    await waitFor(() => expect(lastJobs(calls).query.get("company")).toBe("Acme Corp"));
    fireEvent.click(within(panel()).getByRole("button", { name: /Show all jobs, not only/ }));
    await waitFor(() => expect(lastJobs(calls).query.get("company")).toBeNull());
    fireEvent.click(within(panel()).getByRole("button", { name: "Show all jobs at Beta LLC" }));
    await waitFor(() => expect(lastJobs(calls).query.get("company")).toBe("Beta LLC"));
    fireEvent.click(screen.getByRole("button", { name: "Remove the Beta LLC filter" }));
    await waitFor(() => expect(lastJobs(calls).query.get("company")).toBeNull());
  });

  const addButton = (name: string) => within(panel()).getByRole("button", { name: `Add the contact of ${name} to your contacts` }) as HTMLButtonElement;
  const added = { contactId: "c1", email: "pat@acme.test", name: "Jullie Willis", position: "Talent Lead", charged: true, credits: 99 };
  const addHandler = (reply: { status?: number; json: unknown }): Handler => ({ path, method, ...rest }) =>
    path === "/api/jobs/companies/add-contact" && method === "POST" ? reply : base({ path, method, ...rest } as Call);

  it("Add to Contacts asks the server once for that company, shows Added, and updates the credits", async () => {
    const calls = stubApi(addHandler({ json: added }));
    renderAt(<Jobs />);
    await within(panel()).findByText("Acme Corp");
    await waitFor(() => expect(addButton("Acme Corp").disabled).toBe(false)); // credits have loaded
    fireEvent.click(addButton("Acme Corp"));
    await waitFor(() => expect(addButton("Acme Corp").textContent).toContain("Added"));
    const post = calls.filter((c) => c.path === "/api/jobs/companies/add-contact");
    expect(post).toHaveLength(1);
    expect(post[0]!.body).toEqual({ companyName: "Acme Corp" });
    expect(addButton("Acme Corp").disabled).toBe(true); // cannot be added twice
    expect(addButton("Beta LLC").disabled).toBe(false); // the others are not affected
  });

  it("says plainly when no contact was found, and that nothing was charged", async () => {
    stubApi(addHandler({ status: 404, json: { error: { code: "NO_EMAIL", message: "No contact was found for Acme Corp" } } }));
    renderAt(<Jobs />);
    await within(panel()).findByText("Acme Corp");
    await waitFor(() => expect(addButton("Acme Corp").disabled).toBe(false));
    fireEvent.click(addButton("Acme Corp"));
    expect(await within(panel()).findByText("No contact found. You were not charged.")).toBeTruthy();
    expect(addButton("Acme Corp").disabled).toBe(false); // can be tried again later
  });

  it("disables Add to Contacts when there is no credit left", async () => {
    const calls = stubApi(({ path, method, ...rest }) => (path === "/api/me" ? { json: meDto({ credits: 0 }) } : base({ path, method, ...rest } as Call)));
    renderAt(<Jobs />);
    await within(panel()).findByText("Acme Corp");
    await waitFor(() => expect(addButton("Acme Corp").disabled).toBe(true));
    fireEvent.click(addButton("Acme Corp"));
    expect(calls.some((c) => c.path === "/api/jobs/companies/add-contact")).toBe(false);
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
