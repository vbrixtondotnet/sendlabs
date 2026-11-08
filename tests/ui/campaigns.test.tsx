// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Campaigns } from "../../src/client/pages/Campaigns";
import { page, renderAt, stubApi, summary, totals, type Handler } from "./harness";

const draft = summary({ id: "d1", name: "Draft one", status: "Draft" });
const running = summary({ id: "s1", name: "Running one", status: "Sending", totals: totals({ Accepted: 40, Pending: 60 }) });
const done = summary({ id: "x1", name: "Done one", status: "Completed", totals: totals({ Accepted: 10 }) });

const base: Handler = ({ method, path }) => (path === "/api/campaigns" && method === "GET" ? { json: page([draft, running, done]) } : undefined);
const lastList = (calls: ReturnType<typeof stubApi>) => [...calls].reverse().find((c) => c.path === "/api/campaigns" && c.method === "GET")!;

describe("Campaigns page (live data)", () => {
  it("lists campaigns with status and counts, linking drafts to the editor and others to details", async () => {
    stubApi(base);
    renderAt(<Campaigns />);
    const draftLink = await screen.findByRole("link", { name: "Draft one" });
    expect(draftLink.getAttribute("href")).toBe("/campaigns/d1/edit");
    expect(screen.getByRole("link", { name: "Running one" }).getAttribute("href")).toBe("/campaigns/s1");
    const row = screen.getByRole("link", { name: "Running one" }).closest("tr")!;
    expect(within(row).getByText("Sending")).toBeTruthy();
    expect(within(row).getByText("100")).toBeTruthy(); // 40 accepted + 60 pending
    expect(within(draftLink.closest("tr")!).getByText("Not launched")).toBeTruthy();
  });

  it("sends status, search and archive filters, and defaults to active campaigns", async () => {
    const calls = stubApi(base);
    renderAt(<Campaigns />);
    await screen.findByText("Draft one");
    expect(lastList(calls).query.get("archived")).toBe("exclude");

    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "Paused" } });
    await waitFor(() => expect(lastList(calls).query.get("status")).toBe("Paused"));
    fireEvent.change(screen.getByLabelText("Archived"), { target: { value: "only" } });
    await waitFor(() => expect(lastList(calls).query.get("archived")).toBe("only"));
    fireEvent.change(screen.getByLabelText("Search campaigns"), { target: { value: "migration" } });
    await waitFor(() => expect(lastList(calls).query.get("q")).toBe("migration"), { timeout: 3000 });
  });

  it("offers Delete for drafts only, and Archive only when not in flight", async () => {
    stubApi(base);
    renderAt(<Campaigns />);
    await screen.findByText("Draft one");
    const rowOf = (name: string) => screen.getByRole("link", { name }).closest("tr")!;
    expect(within(rowOf("Draft one")).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(within(rowOf("Running one")).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(rowOf("Running one")).queryByRole("button", { name: "Archive" })).toBeNull(); // in flight
    expect(within(rowOf("Done one")).getByRole("button", { name: "Archive" })).toBeTruthy();
  });

  it("archives through the API", async () => {
    const calls = stubApi((c) => (c.method === "POST" ? { json: summary() } : base(c)));
    renderAt(<Campaigns />);
    await screen.findByText("Done one");
    fireEvent.click(within(screen.getByRole("link", { name: "Done one" }).closest("tr")!).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/campaigns/x1/archive")).toBe(true));
    // the toast (the word also appears as a filter option)
    await waitFor(() => expect(within(screen.getByRole("status")).getByText("Archived")).toBeTruthy());
  });

  it("duplicates, then opens the new draft in the editor", async () => {
    const calls = stubApi((c) => (c.method === "POST" && c.path.endsWith("/duplicate") ? { status: 201, json: { ...summary({ id: "copy1" }) } } : base(c)));
    renderAt(<Campaigns />, { path: "/campaigns", route: "/campaigns" }); // other routes render the "elsewhere" marker
    await screen.findByText("Done one");
    fireEvent.click(within(screen.getByRole("link", { name: "Done one" }).closest("tr")!).getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/campaigns/x1/duplicate")).toBe(true));
    expect(await screen.findByTestId("elsewhere")).toBeTruthy(); // navigated to /campaigns/copy1/edit
  });

  it("confirms before deleting a draft", async () => {
    const calls = stubApi((c) => (c.method === "DELETE" ? { status: 204 } : base(c)));
    renderAt(<Campaigns />);
    await screen.findByText("Draft one");
    fireEvent.click(within(screen.getByRole("link", { name: "Draft one" }).closest("tr")!).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this draft?" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/campaigns/d1")).toBe(true));
  });

  it("shows the server's reason when an action is refused", async () => {
    stubApi((c) => (c.method === "POST" ? { status: 409, json: { error: { code: "CAMPAIGN_IN_FLIGHT", message: "Pause or cancel the campaign before archiving it", correlationId: "x" } } } : base(c)));
    renderAt(<Campaigns />);
    await screen.findByText("Done one");
    fireEvent.click(within(screen.getByRole("link", { name: "Done one" }).closest("tr")!).getByRole("button", { name: "Archive" }));
    expect(await screen.findByText("Pause or cancel the campaign before archiving it")).toBeTruthy();
  });

  it("hides write actions from a Viewer", async () => {
    stubApi(base);
    renderAt(<Campaigns />, { role: "Viewer" });
    await screen.findByText("Draft one");
    expect(screen.queryByRole("button", { name: "Duplicate" })).toBeNull();
    expect(screen.queryByRole("link", { name: /New campaign/ })).toBeNull();
  });

  it("shows the API error instead of an empty table", async () => {
    stubApi(() => ({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Something went wrong", correlationId: "ref-9" } } }));
    renderAt(<Campaigns />);
    expect(await screen.findByText("Reference: ref-9")).toBeTruthy();
  });
});
