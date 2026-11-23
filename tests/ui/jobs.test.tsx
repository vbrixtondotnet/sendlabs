// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { Jobs } from "../../src/client/pages/Jobs";
import { JOBS, postedAgo } from "../../src/client/mock/jobs";
import { renderAt } from "./harness";

const cards = () => screen.getAllByRole("article");

/** Picks an option in one of the searchable multi-selects. */
function pick(name: string, option: RegExp) {
  const box = screen.getByRole("combobox", { name });
  fireEvent.focus(box);
  fireEvent.click(within(screen.getByRole("listbox", { name })).getByRole("option", { name: option }));
}

describe("Jobs page (dummy data)", () => {
  it("is a list of job cards, not a table, 25 to a page", () => {
    renderAt(<Jobs />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
    expect(cards()).toHaveLength(25);
    expect(screen.getByText(`1-25 of ${JOBS.length}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(`26-50 of ${JOBS.length}`)).toBeTruthy();
  });

  it("shows on a card the title, company, type, location (with Remote), how long ago, and Save and Hide", () => {
    renderAt(<Jobs />);
    const job = JOBS[0]!;
    const card = cards()[0]!;
    expect(within(card).getByRole("heading", { name: job.title })).toBeTruthy();
    expect(within(card).getByText(job.company)).toBeTruthy();
    expect(within(card).getByText(job.type)).toBeTruthy();
    expect(within(card).getByText(job.location, { exact: false }).textContent).toContain(job.remote ? "(Remote)" : job.location);
    expect(within(card).getByText(postedAgo(job.postedDaysAgo))).toBeTruthy();
    expect(within(card).getByRole("button", { name: `Save ${job.title}` })).toBeTruthy();
    expect(within(card).getByRole("button", { name: `Hide ${job.title}` })).toBeTruthy();
  });

  it("labels some jobs with the fit badge, like Strong applicant", () => {
    renderAt(<Jobs />);
    expect(JOBS.slice(0, 25).some((j) => j.match === "Strong applicant")).toBe(true);
    expect(screen.getAllByText("Strong applicant").length).toBeGreaterThan(0);
  });

  it("Save toggles the bookmark on that card", () => {
    renderAt(<Jobs />);
    const job = JOBS[0]!;
    fireEvent.click(screen.getByRole("button", { name: `Save ${job.title}`, hidden: false, pressed: false }));
    expect(screen.getAllByRole("button", { name: `Unsave ${job.title}` })[0]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("Hide takes the job off the list, and Show hidden jobs brings it back", () => {
    renderAt(<Jobs />);
    const first = JOBS[0]!;
    const before = cards().length;
    fireEvent.click(within(cards()[0]!).getByRole("button", { name: `Hide ${first.title}` }));
    expect(cards()).toHaveLength(before); // the next job moved up into the page
    expect(screen.getByText(`1-25 of ${JOBS.length - 1}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Show hidden jobs (1)` }));
    expect(screen.getByText(`1-25 of ${JOBS.length}`)).toBeTruthy();
  });

  it("has Category and Location filters that apply when Search is pressed", () => {
    renderAt(<Jobs />);
    pick("Category", /Plumbing/);
    expect(cards()).toHaveLength(25); // nothing changes until Search
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const plumbing = JOBS.filter((j) => j.category === "Plumbing").length;
    expect(plumbing).toBeGreaterThan(0);
    expect(cards()).toHaveLength(Math.min(25, plumbing));
  });

  it("combines the two filters, and several values in one filter mean any of them", () => {
    renderAt(<Jobs />);
    const expected = JOBS.filter((j) => (j.category === "Roofing" || j.category === "HVAC") && j.location === "Austin, TX").length;
    pick("Category", /Roofing/);
    pick("Category", /HVAC/);
    pick("Location", /Austin, TX/);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    if (expected === 0) expect(screen.getByText(/No jobs match these filters/)).toBeTruthy();
    else expect(screen.getByText(`1-${Math.min(25, expected)} of ${expected}`)).toBeTruthy();
  });

  it("says so when nothing matches, and Reset brings every job back", () => {
    renderAt(<Jobs />);
    const cats = ["Painting", "Roofing", "HVAC", "Landscaping", "Carpentry", "Electrical"];
    const locs = ["Seattle, WA", "Miami, FL", "Denver, CO", "Phoenix, AZ"];
    const unused = cats.flatMap((c) => locs.map((l) => [c, l] as const)).find(([c, l]) => !JOBS.some((j) => j.category === c && j.location === l));
    if (unused) {
      pick("Category", new RegExp(unused[0]));
      pick("Location", new RegExp(unused[1]));
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      expect(screen.getByText(/No jobs match these filters/)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(cards()).toHaveLength(25);
  });
});

describe("postedAgo", () => {
  it("reads like a feed", () => {
    expect([0, 1, 3, 6, 7, 20, 29, 30, 44].map(postedAgo)).toEqual(["Today", "1d ago", "3d ago", "6d ago", "1w ago", "2w ago", "4w ago", "1mo ago", "1mo ago"]);
  });
});
