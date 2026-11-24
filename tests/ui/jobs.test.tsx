// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { Jobs } from "../../src/client/pages/Jobs";
import { HIRING_COMPANIES, JOBS, jobMeta, openPositions, postedAgo } from "../../src/client/mock/jobs";
import { renderAt } from "./harness";

const cards = () => screen.getAllByRole("article");
const panel = () => screen.getByRole("complementary", { name: "Hiring Companies" });

/** Picks an option in one of the searchable multi-selects. */
function pick(name: string, option: RegExp) {
  const box = screen.getByRole("combobox", { name });
  fireEvent.focus(box);
  fireEvent.click(within(screen.getByRole("listbox", { name })).getByRole("option", { name: option }));
}
const search = () => fireEvent.click(screen.getByRole("button", { name: "Search Jobs" }));

describe("Jobs page layout", () => {
  it("has the headline, the Job search panel and the Hiring Companies panel", () => {
    renderAt(<Jobs />);
    expect(screen.getByRole("heading", { name: "Find Your Next Opportunity" })).toBeTruthy();
    expect(screen.getByText("Discover remote jobs, freelance projects, and opportunities.")).toBeTruthy();
    const form = screen.getByRole("form", { name: "Job search" });
    expect(within(form).getByText("Job search")).toBeTruthy();
    expect(within(form).getByLabelText("Keyword")).toBeTruthy();
    expect(within(form).getByRole("combobox", { name: "Category" })).toBeTruthy();
    expect(within(form).getByRole("combobox", { name: "Location" })).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Search Jobs" })).toBeTruthy();
    expect(within(panel()).getByText("Hiring Companies")).toBeTruthy();
  });

  it("says how many jobs it is showing, and lists them as cards, not a table, 25 to a page", () => {
    renderAt(<Jobs />);
    expect(screen.getByText(/^Showing /).textContent).toBe(`Showing ${JOBS.length} jobs`);
    expect(screen.queryByRole("table")).toBeNull();
    expect(cards()).toHaveLength(25);
    expect(screen.getByText(`1-25 of ${JOBS.length}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(`26-50 of ${JOBS.length}`)).toBeTruthy();
  });

  it("shows on a job card the title, company, where / kind / pay, skills, how long ago, and Apply Now", () => {
    renderAt(<Jobs />);
    const job = JOBS[0]!;
    const card = cards()[0]!;
    expect(within(card).getByRole("heading", { name: job.title })).toBeTruthy();
    expect(within(card).getByText(job.company)).toBeTruthy();
    expect(within(card).getByText(jobMeta(job))).toBeTruthy(); // e.g. "Remote · Full-time · $3,000-$5,000"
    expect(within(card).getByText(job.skills.join(" · "))).toBeTruthy();
    expect(within(card).getByText(postedAgo(job.postedHoursAgo))).toBeTruthy();
    expect(within(card).getByRole("button", { name: `Apply now: ${job.title}` }).textContent).toBe("Apply Now");
  });
});

describe("Job search", () => {
  it("applies the filters when Search Jobs is pressed, and Reset brings every job back", () => {
    renderAt(<Jobs />);
    pick("Category", /Plumbing/);
    expect(screen.getByText(/^Showing /).textContent).toBe(`Showing ${JOBS.length} jobs`); // nothing changes until Search
    search();
    const plumbing = JOBS.filter((j) => j.category === "Plumbing").length;
    expect(plumbing).toBeGreaterThan(0);
    expect(screen.getByText(/^Showing /).textContent).toBe(`Showing ${plumbing} ${plumbing === 1 ? "job" : "jobs"}`);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText(/^Showing /).textContent).toBe(`Showing ${JOBS.length} jobs`);
  });

  it("keyword matches the title, the company or a skill, ignoring case", () => {
    renderAt(<Jobs />);
    const word = JOBS[0]!.skills[0]!.toUpperCase();
    const expected = JOBS.filter((j) => [j.title, j.company, ...j.skills].some((t) => t.toLowerCase().includes(word.toLowerCase()))).length;
    fireEvent.change(screen.getByLabelText("Keyword"), { target: { value: word } });
    search();
    expect(screen.getByText(/^Showing /).textContent).toBe(`Showing ${expected} ${expected === 1 ? "job" : "jobs"}`);
  });

  it("combines Keyword, Category and Location; several values in one filter mean any of them", () => {
    renderAt(<Jobs />);
    const expected = JOBS.filter((j) => (j.category === "Roofing" || j.category === "HVAC") && j.location === "Austin, TX").length;
    pick("Category", /Roofing/);
    pick("Category", /HVAC/);
    pick("Location", /Austin, TX/);
    search();
    if (expected === 0) expect(screen.getByText(/No jobs match your search/)).toBeTruthy();
    else expect(screen.getByText(/^Showing /).textContent).toBe(`Showing ${expected} ${expected === 1 ? "job" : "jobs"}`);
  });

  it("says so when nothing matches", () => {
    renderAt(<Jobs />);
    fireEvent.change(screen.getByLabelText("Keyword"), { target: { value: "zzzz-no-such-job" } });
    search();
    expect(screen.getByText(/No jobs match your search/)).toBeTruthy();
    expect(screen.getByText(/^Showing /).textContent).toBe("Showing 0 jobs");
  });
});

describe("Hiring Companies panel", () => {
  it("has a card per company: Hiring now, banner, name, industry, a line about it, open positions, View Company", () => {
    renderAt(<Jobs />);
    const items = within(panel()).getAllByRole("listitem");
    expect(items).toHaveLength(HIRING_COMPANIES.length);
    const first = HIRING_COMPANIES[0]!;
    const open = openPositions(first.name);
    expect(within(items[0]!).getByText("Hiring now")).toBeTruthy();
    expect(within(items[0]!).getByText(first.name)).toBeTruthy();
    expect(within(items[0]!).getByText(first.industry)).toBeTruthy();
    expect(within(items[0]!).getByText(first.blurb)).toBeTruthy();
    expect(within(items[0]!).getByText(`${open} Open ${open === 1 ? "Position" : "Positions"}`)).toBeTruthy();
    expect(within(items[0]!).getByRole("button", { name: `View ${first.name}` }).textContent).toBe("View Company");
  });

  it("View Company searches that company's jobs", () => {
    renderAt(<Jobs />);
    const company = HIRING_COMPANIES[2]!;
    fireEvent.click(within(panel()).getByRole("button", { name: `View ${company.name}` }));
    const n = openPositions(company.name);
    expect(screen.getByText(/^Showing /).textContent).toBe(`Showing ${n} ${n === 1 ? "job" : "jobs"}`);
    expect((screen.getByLabelText("Keyword") as HTMLInputElement).value).toBe(company.name);
  });

  it("is not changed by the job filters", () => {
    renderAt(<Jobs />);
    pick("Category", /Plumbing/);
    search();
    expect(within(panel()).getAllByRole("listitem")).toHaveLength(HIRING_COMPANIES.length);
  });
});

describe("postedAgo", () => {
  it("reads like a feed", () => {
    expect([0, 1, 2, 23, 24, 72, 24 * 7, 24 * 20, 24 * 30, 24 * 65].map(postedAgo)).toEqual([
      "Posted just now", "Posted 1 hour ago", "Posted 2 hours ago", "Posted 23 hours ago", "Posted 1 day ago", "Posted 3 days ago",
      "Posted 1 week ago", "Posted 2 weeks ago", "Posted 1 month ago", "Posted 2 months ago",
    ]);
  });
});
