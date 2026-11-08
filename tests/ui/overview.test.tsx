// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { Overview } from "../../src/client/pages/Overview";
import { contact, page, renderAt, stubApi, summary, totals, type Handler } from "./harness";

const running = summary({ id: "s1", name: "Running one", status: "Sending", totals: totals({ Accepted: 40, Failed: 2, Pending: 58 }), nextRunAt: "2026-11-07T17:00:00.000Z" });
const paused = summary({ id: "p1", name: "Paused one", status: "Paused", totals: totals({ Accepted: 10, Pending: 90 }) });
const done = summary({ id: "x1", name: "Done one", status: "Completed", totals: totals({ Accepted: 30 }) });

const api = (items = [running, paused, done]): Handler => ({ method, path }) => {
  if (path === "/api/campaigns" && method === "GET") return { json: page(items) };
  if (path === "/api/contacts" && method === "GET") return { json: page([contact()], 7968) };
  return undefined;
};

describe("Overview (live data)", () => {
  it("derives its figures from the campaigns and contacts APIs", async () => {
    stubApi(api());
    renderAt(<Overview />);
    const card = async (label: string) => (await screen.findByText(label)).parentElement!;
    expect(within(await card("Contacts")).getByText("7,968")).toBeTruthy();
    expect(within(await card("Campaigns")).getByText("3")).toBeTruthy();
    expect(within(await card("Accepted by Gmail")).getByText("80")).toBeTruthy(); // 40 + 10 + 30
    expect(within(await card("Failed")).getByText("2")).toBeTruthy();
  });

  it("shows the sending campaign and flags paused or failing ones", async () => {
    stubApi(api());
    renderAt(<Overview />);
    expect((await screen.findAllByText("Running one")).length).toBeGreaterThan(0); // "Now sending" and "Recent"
    const attention = screen.getByText("Needs attention").parentElement!.parentElement!.parentElement!; // h2 > title block > header > card
    expect(within(attention).getByText("Paused one")).toBeTruthy();
    expect(within(attention).getByText("2 failed")).toBeTruthy();
    expect(within(attention).queryByText("Done one")).toBeNull();
  });

  it("is honest when nothing is sending", async () => {
    stubApi(api([done]));
    renderAt(<Overview />);
    expect(await screen.findByText("No campaign is sending")).toBeTruthy();
    expect(screen.getByText("Nothing needs attention.")).toBeTruthy();
  });

  it("invites you to create a first campaign", async () => {
    stubApi(api([]));
    renderAt(<Overview />);
    expect(await screen.findByText(/No campaigns yet/)).toBeTruthy();
  });

  it("shows the API error when it cannot load", async () => {
    stubApi(() => ({ status: 503, json: { error: { code: "AUTH_NOT_CONFIGURED", message: "x", correlationId: "ref-5" } } }));
    renderAt(<Overview />);
    expect(await screen.findByText("Reference: ref-5")).toBeTruthy();
  });
});
