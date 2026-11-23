// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { People } from "../../src/client/pages/People";
import type { PersonDto } from "../../src/shared/api";
import { page, renderAt, stubApi, type Handler } from "./harness";

const person = (over: Partial<PersonDto> = {}): PersonDto => ({
  id: "p1", firstName: "Ava", lastName: "Smith", title: "CEO", companyName: "Summit Group", employees: 1400,
  industry: "Retail", website: "https://www.summitgroup.example", city: "Austin", state: "Texas", country: "United States", ...over,
});
const reply = (items: PersonDto[], total = items.length) => ({ json: page(items, total, 1, 50) });
const base: Handler = ({ path }) => (path === "/api/people/industries" ? { json: { items: ["Retail", "Software"] } } : path === "/api/people" ? reply([person(), person({ id: "p2", firstName: "Liam", city: "", state: "" })]) : undefined);
const lastSearch = (calls: ReturnType<typeof stubApi>) => [...calls].reverse().find((c) => c.path === "/api/people");

describe("People page", () => {
  it("shows the requested columns (and no sample-data warning), with the rows", async () => {
    stubApi(base);
    renderAt(<People />);
    expect(screen.queryByText("Sample data")).toBeNull();
    expect(await screen.findByText("Ava")).toBeTruthy();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["First Name", "Last Name", "Title", "Company Name", "Email", "# Employees", "Industry", "City", "State", "Country"]);
    const row = screen.getByText("Ava").closest("tr")!;
    expect(within(row).getByText("1,400")).toBeTruthy();
    expect(within(row).queryByRole("link", { name: "LinkedIn" })).toBeNull();
    expect(screen.queryByText(/people found/)).toBeNull();
    // The email is hidden: a button reveals it (for a credit) instead of the address.
    expect(within(row).getByRole("button", { name: "Add Contact" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Add Contact" })).toHaveLength(2);
    expect(document.body.textContent).not.toContain("ava.smith@summitgroup.example");
    expect(screen.getByRole("note").textContent).toMatch(/Reveal a contact.s email address by adding it to your contacts\. Each reveal costs 1 credit\./);
  });

  it("picks several countries from a searchable dropdown", async () => {
    stubApi(base);
    renderAt(<People />);
    await screen.findByText("Ava");
    const box = screen.getByRole("combobox", { name: "Country" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "germ" } });
    const list = screen.getByRole("listbox", { name: "Country" });
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(within(list).getByRole("option", { name: /Germany/ }));
    fireEvent.change(box, { target: { value: "can" } });
    fireEvent.click(within(screen.getByRole("listbox", { name: "Country" })).getByRole("option", { name: /Canada/ }));
    expect(screen.getByRole("button", { name: "Remove Germany" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Canada" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Germany" }));
    expect(screen.queryByRole("button", { name: "Remove Germany" })).toBeNull();
  });

  it("sends all the filters only when Search is pressed", async () => {
    const calls = stubApi(base);
    renderAt(<People />);
    await screen.findByText("Ava");
    const before = calls.length;

    const box = screen.getByRole("combobox", { name: "Country" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "japan" } });
    fireEvent.click(within(screen.getByRole("listbox", { name: "Country" })).getByRole("option", { name: /Japan/ }));
    const industry = screen.getByRole("combobox", { name: "Industry" });
    fireEvent.focus(industry);
    fireEvent.click(await within(await screen.findByRole("listbox", { name: "Industry" })).findByRole("option", { name: /Retail/ }));
    fireEvent.change(screen.getByLabelText("Company size"), { target: { value: "51,200" } });
    const titles = screen.getByLabelText("Job titles");
    fireEvent.change(titles, { target: { value: "Marketing Manager" } });
    fireEvent.keyDown(titles, { key: "Enter" });
    expect(calls.length).toBe(before); // nothing sent yet

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(lastSearch(calls)!.query.get("countries")).toBe("Japan"));
    const q = lastSearch(calls)!.query;
    expect(q.get("industries")).toBe("Retail");
    expect(q.get("companySize")).toBe("51,200");
    expect(q.get("titles")).toBe("Marketing Manager");
    expect(q.get("page")).toBe("1");
  });

  it("shows a dash for a missing city or state", async () => {
    stubApi(({ path }) => (path === "/api/people/industries" ? { json: { items: [] } } : path === "/api/people" ? reply([person({ city: "", state: "", employees: null })]) : undefined));
    renderAt(<People />);
    const row = (await screen.findByText("Ava")).closest("tr")!;
    expect(within(row).getAllByText("-")).toHaveLength(3); // city, state and the unknown employee count
  });

  it("says so when nothing matches", async () => {
    stubApi(({ path }) => (path === "/api/people/industries" ? { json: { items: [] } } : path === "/api/people" ? reply([]) : undefined));
    renderAt(<People />);
    expect(await screen.findByText(/No people match these filters/)).toBeTruthy();
  });

  it("pages on the server: the next page is a new request, and the totals come from the API", async () => {
    const calls = stubApi(({ path, query }) =>
      path === "/api/people/industries" ? { json: { items: [] } }
      : path === "/api/people" ? { json: page([person({ id: `p${query.get("page")}`, firstName: `Page${query.get("page")}` })], 120, Number(query.get("page")), 50) }
      : undefined);
    renderAt(<People />);
    expect(await screen.findByText("Page1")).toBeTruthy();
    expect(screen.getByText("1-50 of 120")).toBeTruthy(); // the total still shows in the pager
    expect(lastSearch(calls)!.query.get("pageSize")).toBe("50");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page2")).toBeTruthy();
    expect(lastSearch(calls)!.query.get("page")).toBe("2");
  });
});
