// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { EmailTemplates } from "../../src/client/pages/EmailTemplates";
import { meDto, renderAt, stubApi, type Call } from "./harness";

const T = "2026-11-01T10:00:00.000Z";
const handler = (c: Call) => {
  if (c.path === "/api/me") return { json: meDto({ role: "SuperAdmin" }) };
  if (c.method === "GET" && c.path === "/api/email-templates/available") return { json: { items: [{ id: "construction", name: "Construction", createdAt: T, updatedAt: T }] } };
  if (c.method === "GET" && c.path === "/api/email-templates/available/construction") return { json: { id: "construction", name: "Construction", createdAt: T, updatedAt: T, htmlBody: "<p>Hello {{firstName}}</p>" } };
  return undefined;
};

describe("Available Templates as a SuperAdmin", () => {
  it("has View and Delete in the list, and Edit only inside the view panel", async () => {
    stubApi(handler);
    renderAt(<EmailTemplates />);
    await screen.findByRole("button", { name: "Create template" }); // the SuperAdmin view (the role has loaded)
    const row = (await screen.findByText("Construction", { selector: "td" })).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Actions for Construction" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["View", "Delete"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "View Construction" }));
    const panel = await screen.findByRole("dialog", { name: "Construction" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("dialog", { name: "Edit Construction" })).toBeTruthy();
  });
});
