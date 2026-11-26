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
  user: { id: "u1", role: "Agency", avatarUrl: null, email: "admin@sabertoothsoftwarelabs.net", firstName: "", lastName: "", position: "", displayName: "Administrator", mustChangePassword: false, credits: 100, ...over },
  company: { name: tenantName, postalAddress: "", website: "", requireUnsubscribeLink: true, oneClickUnsubscribe: true },
  session: false,
});

const open = () => renderAt(<Layout />);

describe("the left menu has no Settings", () => {
  const links = () => screen.getAllByRole("link").map((l) => l.textContent);

  it("has the other items but no Settings link (it is Account Settings in the user menu)", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    await screen.findByTestId("user-icon");
    expect(links()).toEqual(expect.arrayContaining(["Overview", "Imports", "Contacts", "Search People", "Campaigns"]));
    expect(links()).not.toContain("Settings");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

});

describe("what the menu shows for each kind of account", () => {
  const nav = () => within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link").map((l) => l.textContent);
  const openAs = async (role: "SuperAdmin" | "JobSeeker" | "Agency") => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ role }) } : undefined));
    open();
    await screen.findByTestId("user-icon");
  };

  it("JobSeeker: everything except Campaigns, with Jobs straight after the people tools", async () => {
    await openAs("JobSeeker");
    expect(nav()).toEqual(["Jobs", "Contacts", "Search People", "Summary"]);
    expect(screen.getByRole("link", { name: "Jobs" }).getAttribute("href")).toBe("/jobs");
    expect(screen.queryByRole("link", { name: "New campaign" })).toBeNull();
  });

  it("Agency: everything except Jobs", async () => {
    await openAs("Agency");
    expect(nav()).toEqual(["Overview", "Imports", "Contacts", "Search People", "Campaigns", "Email Templates"]);
    expect(screen.getByRole("link", { name: "New campaign" }).getAttribute("href")).toBe("/campaigns/new");
  });

  it("SuperAdmin: only Email Templates, Global Contacts and User Accounts, with no search box or credits", async () => {
    await openAs("SuperAdmin");
    expect(nav()).toEqual(["Email Templates", "Global Contacts", "User Accounts"]);
    expect(screen.getByRole("link", { name: "User Accounts" }).getAttribute("href")).toBe("/users");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByText("100 Credits")).toBeNull();
  });
});

describe("the Gmail-style shell", () => {
  it("has a New campaign button above the navigation for creating one", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    expect((await screen.findByRole("link", { name: "New campaign" })).getAttribute("href")).toBe("/campaigns/new");
  });

  it("has a search box in the top bar, and the menu button folds the navigation to icons and back", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    expect(await screen.findByRole("searchbox", { name: "Search contacts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(screen.getByRole("button", { name: "Expand navigation" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "Contacts" }).getAttribute("title")).toBe("Contacts"); // icon only: the name moves to a tooltip
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeTruthy();
  });
});

describe("the credits badge (mockup)", () => {
  it("shows 100 Credits at the top right for an account", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    expect(await screen.findByText("100 Credits")).toBeTruthy();
  });

});

describe("the header shows the real company and user", () => {
  it("shows the signed-in user (icon, full name, arrow), and nothing hardcoded", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    const avatar = await screen.findByLabelText("Signed in as admin@sabertoothsoftwarelabs.net");
    expect(screen.getByTestId("user-icon").textContent).toBe("AD");
    expect(avatar.textContent).toContain("Administrator"); // the full name
    expect(avatar.getAttribute("title")).toContain("admin@sabertoothsoftwarelabs.net");
    expect(screen.queryByText("Sabertooth Software Labs")).toBeNull(); // the company name is not in the header any more
    expect(document.body.textContent).not.toContain("Brian");
    expect(screen.queryByLabelText("Signed in as Brian V.")).toBeNull();
  });

  it("has no \"Preview as\" role switch: what you can do is what your account allows", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    await screen.findByTestId("user-icon");
    expect(screen.queryByLabelText("Preview as")).toBeNull();
    expect(screen.queryByText("Preview as")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows another account's full name", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ email: "admin@globex.test", displayName: "Hank Scorpio" }, "Globex Corp") } : undefined));
    open();
    const who = await screen.findByLabelText("Signed in as admin@globex.test");
    expect(screen.getByTestId("user-icon").textContent).toBe("HS");
    expect(who.textContent).toContain("Hank Scorpio");
    expect(screen.queryByText("Globex Corp")).toBeNull();
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

  it("the user button opens a menu with Account Settings and Logout, and closes again", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    const circle = await screen.findByRole("button", { name: "Signed in as admin@sabertoothsoftwarelabs.net" });
    expect(circle.className).toContain("cursor-pointer"); // the hand cursor says it can be clicked
    expect(circle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(circle);
    expect(circle.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Account Settings", "Logout"]);
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

  it("Account Settings in the menu goes to the user's own settings page and closes the menu", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    renderAt(<Layout />, { path: "/campaigns", route: "/campaigns" });
    fireEvent.click(await screen.findByRole("button", { name: /Signed in as/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Account Settings" }));
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

describe("what a JobSeeker's menu looks like", () => {
  const nav = () => within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")]);

  it("has Jobs first, Summary after Search People, and no Email Templates, Imports or Settings", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ role: "JobSeeker" }) } : undefined));
    open();
    await screen.findByTestId("user-icon");
    expect(nav()).toEqual([["Jobs", "/jobs"], ["Contacts", "/contacts"], ["Search People", "/people"], ["Summary", "/summary"]]);
  });

  it("sends anyone who opens /settings (or comes back from Google) to the email tab of Account Settings", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ role: "JobSeeker" }) } : undefined));
    renderAt(<Layout />, { path: "/settings?sender=connected", route: "/settings" });
    await waitFor(() => expect(screen.getByTestId("elsewhere").getAttribute("data-location")).toBe("/account?sender=connected&tab=email"));
  });
});

describe("where each account lands", () => {
  it("a JobSeeker who opens / (as after signing in) lands on Jobs, and can still open Summary", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ role: "JobSeeker" }) } : undefined));
    renderAt(<Layout />, { path: "/", route: "/" });
    await waitFor(() => expect(screen.getByTestId("elsewhere").getAttribute("data-location")).toBe("/jobs"));
  });

  it("a JobSeeker can open /summary", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ role: "JobSeeker" }) } : undefined));
    renderAt(<Layout />, { path: "/summary", route: "/summary" });
    await screen.findByTestId("user-icon");
    expect(screen.queryByTestId("elsewhere")).toBeNull();
  });

  it("an Agency still lands on / (its Overview)", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ role: "Agency" }) } : undefined));
    renderAt(<Layout />, { path: "/", route: "/" });
    await screen.findByTestId("user-icon");
    expect(screen.queryByTestId("elsewhere")).toBeNull();
  });
});

describe("the right side of the header", () => {
  it("reads, in order: Credits, a | separator, the user icon, the full name and a down arrow that opens the menu", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ firstName: "Brixton Ray", lastName: "Villanueva", displayName: "Brixton Ray Villanueva" }) } : undefined));
    open();
    const trigger = await screen.findByRole("button", { name: /Signed in as/ });
    const credits = screen.getByText("100 Credits");
    const bar = screen.getByText("|");
    const icon = screen.getByTestId("user-icon");
    const order = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order(credits, bar)).toBe(true);
    expect(order(bar, icon)).toBe(true);
    expect(trigger.textContent).toBe("BVBrixton Ray Villanueva");
    expect(trigger.querySelector("svg")).toBeTruthy(); // the down arrow
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Account menu" })).toBeTruthy();
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Account Settings" })).toBeTruthy();
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Logout" })).toBeTruthy();
  });

  it("shows no Credits or separator for a SuperAdmin, only the user", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ role: "SuperAdmin" }) } : undefined));
    open();
    await screen.findByTestId("user-icon");
    expect(screen.queryByText("|")).toBeNull();
    expect(screen.queryByText(/Credits/)).toBeNull();
  });
});

describe("the profile picture in the header", () => {
  it("replaces the initials with the uploaded picture", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ avatarUrl: "/api/me/avatar?v=3" }) } : undefined));
    open();
    const icon = await screen.findByTestId("user-icon");
    const img = icon.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/api/me/avatar?v=3");
    expect(icon.textContent).toBe("");
  });

  it("shows the initials when there is no picture", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me() } : undefined));
    open();
    const icon = await screen.findByTestId("user-icon");
    expect(icon.querySelector("img")).toBeNull();
    expect(icon.textContent).toBe("AD");
  });
});
