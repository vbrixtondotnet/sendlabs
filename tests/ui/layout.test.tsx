// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Layout } from "../../src/client/components/Layout";
import { initialsOf } from "../../src/client/services/me";
import type { MeDto } from "../../src/shared/api";
import { renderAt, stubApi } from "./harness";

vi.mock("../../src/client/lib/navigate", () => ({ goTo: vi.fn() }));
import { goTo } from "../../src/client/lib/navigate";

beforeEach(() => vi.mocked(goTo).mockClear());

const me = (over: Partial<MeDto["user"]> = {}, tenantName = "Sabertooth Software Labs"): MeDto => ({
  user: { id: "u1", email: "admin@sabertoothsoftwarelabs.net", firstName: "", lastName: "", position: "", displayName: "Administrator", access: "Administrator", mustChangePassword: false, ...over },
  tenant: { id: "t1", name: tenantName, slug: "sabertooth-software-labs", postalAddress: "", website: "", requireUnsubscribeLink: true, oneClickUnsubscribe: true },
  session: false,
});

const open = () => renderAt(<Layout />);

describe("the Settings menu is for Administrators only", () => {
  const links = () => screen.getAllByRole("link").map((l) => l.textContent);

  it("shows Settings to an Administrator, with the other items", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ access: "Administrator" }) } : undefined));
    open();
    await screen.findByText("Sabertooth Software Labs");
    expect(links()).toEqual(expect.arrayContaining(["Overview", "Imports", "Contacts", "Campaigns", "Settings"]));
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByText("Settings are a preview")).toBeTruthy();
  });

  it.each(["Campaign Manager", "Viewer"] as const)("hides Settings from a %s, who still gets everything else", async (access) => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ access }) } : undefined));
    open();
    await screen.findByText("Sabertooth Software Labs");
    expect(links()).toEqual(expect.arrayContaining(["Overview", "Imports", "Contacts", "Campaigns"]));
    expect(links()).not.toContain("Settings");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.queryByText("Settings are a preview")).toBeNull();
  });

  it("does not offer Settings while it is still unknown who is signed in", () => {
    vi.stubGlobal("fetch", () => new Promise(() => undefined)); // never answers: who is signed in stays unknown
    open();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});

describe("the header shows the real tenant and user", () => {
  it("shows the tenant's name and the signed-in user, and nothing hardcoded", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    expect(await screen.findByText("Sabertooth Software Labs")).toBeTruthy();
    const avatar = screen.getByLabelText("Signed in as admin@sabertoothsoftwarelabs.net");
    expect(avatar.textContent).toBe("AD");
    expect(avatar.getAttribute("title")).toContain("admin@sabertoothsoftwarelabs.net");
    expect(document.body.textContent).not.toContain("Brian");
    expect(screen.queryByLabelText("Signed in as Brian V.")).toBeNull();
  });

  it("has no \"Preview as\" role switch: what you can do is what your account allows", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    await screen.findByText("Sabertooth Software Labs");
    expect(screen.queryByLabelText("Preview as")).toBeNull();
    expect(screen.queryByText("Preview as")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows another tenant's name for another tenant's user", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ email: "admin@globex.test", displayName: "Hank Scorpio" }, "Globex Corp") } : undefined));
    open();
    expect(await screen.findByText("Globex Corp")).toBeTruthy();
    expect(screen.getByLabelText("Signed in as admin@globex.test").textContent).toBe("HS");
    expect(screen.queryByText("Sabertooth Software Labs")).toBeNull();
  });

  it("sends someone who is not signed in to the login page, remembering where they were going", async () => {
    stubApi(() => ({ status: 401, json: { error: { code: "NO_ACTIVE_USER", message: "Not signed in", correlationId: "x" } } }));
    renderAt(<Layout />, { path: "/campaigns?tab=sent", route: "/campaigns" });
    const there = await screen.findByTestId("elsewhere");
    expect(there.getAttribute("data-location")).toBe("/login?next=%2Fcampaigns%3Ftab%3Dsent");
    expect(screen.queryByLabelText(/Signed in as/)).toBeNull();
  });

  it("does not bounce to login for other failures, such as the API being down", async () => {
    stubApi(() => ({ status: 500, json: { error: { code: "INTERNAL", message: "boom", correlationId: "x" } } }));
    open();
    expect(await screen.findByText("Not signed in")).toBeTruthy();
    expect(screen.queryByTestId("elsewhere")).toBeNull();
  });

  it("the initials circle opens a menu with Settings and Logout, and closes again", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    const circle = await screen.findByRole("button", { name: "Signed in as admin@sabertoothsoftwarelabs.net" });
    expect(circle.className).toContain("cursor-pointer"); // the hand cursor says it can be clicked
    expect(circle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(circle);
    expect(circle.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Settings", "Logout"]);
    for (const item of within(menu).getAllByRole("menuitem")) expect(item.className, item.textContent ?? "").toContain("cursor-pointer");
    expect(within(menu).getByText("admin@sabertoothsoftwarelabs.net")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(circle);
    fireEvent.mouseDown(document.body); // a click anywhere else
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(circle);
    fireEvent.click(circle); // the circle toggles it
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Settings in the menu goes to the user's own settings page and closes the menu", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    renderAt(<Layout />, { path: "/campaigns", route: "/campaigns" });
    fireEvent.click(await screen.findByRole("button", { name: /Signed in as/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect((await screen.findByTestId("elsewhere")).getAttribute("data-location")).toBe("/account");
  });

  it("Logout ends the session and returns to the login page", async () => {
    const calls = stubApi(({ path, method }) => (path === "/api/me" ? { json: me() } : method === "POST" && path === "/api/auth/logout" ? { status: 204 } : undefined));
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Signed in as/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Logout" }));
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("/login"));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/auth/logout")).toBe(true);
  });

  it("there is no separate Sign out button any more", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    await screen.findByRole("button", { name: /Signed in as/ });
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});

describe("initials", () => {
  it("uses two letters from the display name, or the email when there is no name", () => {
    expect(initialsOf("Ada Lovelace", "ada@x.test")).toBe("AL");
    expect(initialsOf("Administrator", "admin@x.test")).toBe("AD");
    expect(initialsOf("", "grace.hopper@x.test")).toBe("GH");
    expect(initialsOf("", "root@x.test")).toBe("RO");
    expect(initialsOf("  ", "")).toBe("?");
  });
});

describe("the Email Templates menu item", () => {
  const links = () => screen.getAllByRole("link").map((l) => l.textContent);

  it.each(["Administrator", "Campaign Manager"] as const)("is in the left navigation for a %s, straight after Campaigns", async (access) => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ access }) } : undefined));
    open();
    await screen.findByText("Sabertooth Software Labs");
    const order = links();
    expect(order).toContain("Email Templates");
    expect(order.indexOf("Email Templates")).toBe(order.indexOf("Campaigns") + 1);
    expect(screen.getByRole("link", { name: "Email Templates" }).getAttribute("href")).toBe("/templates");
  });

  it("is the only item in the left navigation for a SuperAdministrator, who belongs to no tenant, and is where they land", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ access: "SuperAdministrator" }, "Sendrix Platform") } : undefined));
    open();
    await screen.findByText("Sendrix Platform"); // who is signed in has loaded
    expect(links().filter((l) => ["Overview", "Imports", "Contacts", "Campaigns", "Settings"].includes(l ?? ""))).toEqual([]);
    expect(links()).toContain("Email Templates");
  });

  it("is not in the left navigation for a Viewer, who has no access to Email Templates", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ access: "Viewer" }) } : undefined));
    open();
    await screen.findByText("Sabertooth Software Labs");
    expect(links()).toContain("Campaigns");
    expect(links()).not.toContain("Email Templates");
  });
});
