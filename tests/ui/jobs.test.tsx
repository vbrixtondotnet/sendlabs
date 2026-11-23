// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { Jobs } from "../../src/client/pages/Jobs";
import { JOBS } from "../../src/client/mock/jobs";
import { renderAt } from "./harness";

const bodyRows = () => screen.getAllByRole("row").slice(1); // without the header row

/** Picks an option in one of the searchable multi-selects. */
function pick(name: string, option: RegExp) {
  const box = screen.getByRole("combobox", { name });
  fireEvent.focus(box);
  fireEvent.click(within(screen.getByRole("listbox", { name })).getByRole("option", { name: option }));
}

describe("Jobs page (dummy data)", () => {
  it("lists jobs in the standard table, newest first, 25 to a page", () => {
    renderAt(<Jobs />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Job", "Company", "Category", "Location", "Type", "Posted"]);
    expect(bodyRows()).toHaveLength(25);
    expect(screen.getByText(`1-25 of ${JOBS.length}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(`26-50 of ${JOBS.length}`)).toBeTruthy();
  });

  it("has Category and Location filters that apply when Search is pressed", () => {
    renderAt(<Jobs />);
    pick("Category", /Plumbing/);
    expect(bodyRows()).toHaveLength(25); // nothing changes until Search
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const plumbing = JOBS.filter((j) => j.category === "Plumbing").length;
    expect(plumbing).toBeGreaterThan(0);
    const shown = bodyRows();
    expect(shown).toHaveLength(Math.min(25, plumbing));
    expect(shown.every((r) => within(r).queryByText("Plumbing") !== null)).toBe(true);
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
    // pick a pair that does not occur in the data
    const unused = ["Painting", "Roofing", "HVAC", "Landscaping", "Carpentry", "Electrical"].flatMap((c) => ["Remote", "Seattle, WA", "Miami, FL", "Denver, CO"].map((l) => [c, l] as const)).find(([c, l]) => !JOBS.some((j) => j.category === c && j.location === l));
    if (unused) {
      pick("Category", new RegExp(unused[0]));
      pick("Location", new RegExp(unused[1]));
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      expect(screen.getByText(/No jobs match these filters/)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(bodyRows()).toHaveLength(25);
  });
});
