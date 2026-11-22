// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { People } from "../../src/client/pages/People";
import type { PersonDto } from "../../src/shared/api";
import { page, renderAt, stubApi, type Handler } from "./harness";

const person = (over: Partial<PersonDto> = {}): PersonDto => ({
  id: "p1", firstName: "Ava", lastName: "Smith", title: "CEO", companyName: "Summit Group", email: "ava.smith@summitgroup.example", employees: 1400,
  industry: "Retail", linkedinUrl: "https://www.linkedin.com/in/ava-smith-1", website: "https://www.summitgroup.example", city: "Austin", state: "Texas", country: "United States", ...over,
});
const reply = (items: PersonDto[], total = items.length) => ({ json: { ...page(items, total, 1, 15), source: "mock" } });
const base: Handler = ({ path }) => (path === "/api/people" ? reply([person(), person({ id: "p2", firstName: "Liam", email: "liam@x.example", city: "", state: "" })]) : undefined);
const lastSearch = (calls: ReturnType<typeof stubApi>) => [...calls].reverse().find((c) => c.path === "/api/people");

describe("People page", () => {
  it("shows the sample-data notice and the requested columns, with the rows", async () => {
    stubApi(base);
    renderAt(<People />);
    expect(screen.getByText("Sample data")).toBeTruthy();
    expect(await screen.findByText("ava.smith@summitgroup.example")).toBeTruthy();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["First Name", "Last Name", "Title", "Company Name", "Email", "# Employees", "Industry", "Person Linkedin Url", "Website", "City", "State", "Country"]);
    const row = screen.getByText("ava.smith@summitgroup.example").closest("tr")!;
    expect(within(row).getByText("1,400")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "LinkedIn" }).getAttribute("href")).toBe("https://www.linkedin.com/in/ava-smith-1");
    expect(screen.getByText("2 people found")).toBeTruthy();
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
    fireEvent.change(screen.getByLabelText("Industry"), { target: { value: "Retail" } });
    fireEvent.change(screen.getByLabelText("Company size"), { target: { value: "51,200" } });
    const titles = screen.getByLabelText("Job titles");
    fireEvent.change(titles, { target: { value: "Marketing Manager" } });
    fireEvent.keyDown(titles, { key: "Enter" });
    expect(calls.length).toBe(before); // nothing sent yet

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(lastSearch(calls)!.query.get("countries")).toBe("Japan"));
    const q = lastSearch(calls)!.query;
    expect(q.get("industry")).toBe("Retail");
    expect(q.get("companySize")).toBe("51,200");
    expect(q.get("titles")).toBe("Marketing Manager");
    expect(q.get("page")).toBe("1");
  });

  it("shows a dash for a missing city or state", async () => {
    stubApi(({ path }) => (path === "/api/people" ? reply([person({ city: "", state: "" })]) : undefined));
    renderAt(<People />);
    const row = (await screen.findByText("ava.smith@summitgroup.example")).closest("tr")!;
    expect(within(row).getAllByText("-")).toHaveLength(2);
  });

  it("says so when nothing matches", async () => {
    stubApi(({ path }) => (path === "/api/people" ? reply([]) : undefined));
    renderAt(<People />);
    expect(await screen.findByText(/No people match these filters/)).toBeTruthy();
  });
});
