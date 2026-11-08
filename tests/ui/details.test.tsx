// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CampaignDetails } from "../../src/client/pages/CampaignDetails";
import type { CampaignDto } from "../../src/shared/api";
import { campaign, page, recipient, renderAt, stubApi, totals, type Handler } from "./harness";

const sending = campaign({ id: "k1", status: "Sending", totals: totals({ Accepted: 40, Failed: 2, Pending: 58 }), launchedAt: "2026-11-01T17:00:00.000Z", nextRunAt: "2026-11-07T17:00:00.000Z" });

/** Serves a campaign whose status follows the actions posted to it, like the real API. */
function server(initial: CampaignDto): Handler {
  let current = initial;
  return ({ method, path, query }) => {
    if (method === "GET" && path === `/api/campaigns/${current.id}`) return { json: current };
    if (method === "GET" && path === `/api/campaigns/${current.id}/recipients`) {
      const rows = [
        recipient({ id: "r1", status: "Accepted", attemptCount: 1, acceptedAt: "2026-11-02T17:00:00.000Z" }),
        recipient({ id: "r2", email: "bad@example.test", personalization: {}, status: "Failed", attemptCount: 3, lastError: "Recipient address rejected (550 5.1.1)" }),
        recipient({ id: "r3", email: "skip@example.test", personalization: {}, status: "Skipped", skipReason: "Suppressed" }),
      ].filter((r) => !query.get("status") || r.status === query.get("status"));
      return { json: page(rows, rows.length) };
    }
    const m = path.match(/^\/api\/campaigns\/k1\/(pause|resume|cancel)$/);
    if (method === "POST" && m) {
      const to = { pause: "Paused", resume: "Sending", cancel: "Cancelled" }[m[1] as "pause"] as CampaignDto["status"];
      current = { ...current, status: to };
      return { json: current };
    }
    return undefined;
  };
}

const open = (_handler: Handler, role?: "Viewer") =>
  renderAt(<CampaignDetails />, { path: "/campaigns/k1", route: "/campaigns/:id", ...(role ? { role } : {}) });

describe("Campaign details (live data)", () => {
  it("shows the real totals, schedule and recipient rows", async () => {
    stubApi(server(sending));
    open(server(sending));
    expect(await screen.findByRole("heading", { name: "Access-to-SQL" })).toBeTruthy();
    expect(screen.getByText("40.0% of list")).toBeTruthy(); // 40 of 100 accepted
    const awaiting = screen.getByText("Awaiting send").parentElement!;
    expect(within(awaiting).getByText("58")).toBeTruthy();
    expect(screen.getByText("09:00 to 17:00")).toBeTruthy();
    expect(screen.getByText("America/Los_Angeles")).toBeTruthy();
    expect(await screen.findByText("Nick Harbaugh")).toBeTruthy();
    expect(screen.getByText("Recipient address rejected (550 5.1.1)")).toBeTruthy();
    expect(screen.getByText("Suppressed")).toBeTruthy(); // skip reason
    expect(screen.getAllByText("Accepted by Gmail").length).toBeGreaterThan(0);
    expect(screen.queryByText("Delivered")).toBeNull(); // acceptance is never called delivery
  });

  it("pauses, then offers Resume instead of Pause", async () => {
    const calls = stubApi(server(sending));
    open(server(sending));
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/campaigns/k1/pause")).toBe(true));
    expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.getByText(/No further messages will be queued until you resume/)).toBeTruthy();
  });

  it("asks before cancelling, and says what cannot be undone", async () => {
    const calls = stubApi(server(sending));
    open(server(sending));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel campaign" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this campaign?" });
    expect(calls.some((c) => c.path.endsWith("/cancel"))).toBe(false);
    expect(within(dialog).getByText(/already accepted cannot be recalled/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel campaign" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/campaigns/k1/cancel")).toBe(true));
    expect(await screen.findByText(/Unsent recipients were marked Cancelled/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel campaign" })).toBeNull(); // final state, no actions left
  });

  it("filters recipients by status through the API", async () => {
    const calls = stubApi(server(sending));
    open(server(sending));
    await screen.findByText("Nick Harbaugh");
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "Failed" } });
    await waitFor(() => expect([...calls].reverse().find((c) => c.path.endsWith("/recipients"))!.query.get("status")).toBe("Failed"));
    await waitFor(() => expect(screen.queryByText("Nick Harbaugh")).toBeNull());
    expect(screen.getByText("bad@example.test")).toBeTruthy();
  });

  it("offers no actions that the state machine would refuse", async () => {
    stubApi(server(campaign({ id: "k1", status: "Completed", totals: totals({ Accepted: 5 }) })));
    open(server(sending));
    await screen.findByRole("heading", { name: "Access-to-SQL" });
    for (const name of ["Pause", "Resume", "Cancel campaign"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.getByText(/Nothing left to send/)).toBeTruthy();
  });

  it("explains a draft and links to the editor", async () => {
    stubApi(server(campaign({ id: "k1", status: "Draft" })));
    open(server(sending));
    expect(await screen.findByText(/Launching is not connected yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit draft" }).getAttribute("href")).toBe("/campaigns/k1/edit");
  });

  it("hides every action from a Viewer", async () => {
    stubApi(server(sending));
    open(server(sending), "Viewer");
    await screen.findByRole("heading", { name: "Access-to-SQL" });
    for (const name of ["Pause", "Cancel campaign"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("shows the server's reason when an action is refused", async () => {
    stubApi((c) =>
      c.method === "POST"
        ? { status: 409, json: { error: { code: "INVALID_TRANSITION", message: "Cannot pause a campaign that is Paused", correlationId: "x" } } }
        : server(sending)(c),
    );
    open(server(sending));
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    expect(await screen.findByText("Cannot pause a campaign that is Paused")).toBeTruthy();
  });

  it("says so when the campaign does not exist", async () => {
    stubApi(({ path }) => (path === "/api/campaigns/k1" ? { status: 404, json: { error: { code: "NOT_FOUND", message: "Campaign not found", correlationId: "x" } } } : undefined));
    open(server(sending));
    expect(await screen.findByText("Campaign not found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to campaigns" })).toBeTruthy();
  });
});
