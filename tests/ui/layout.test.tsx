// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Layout } from "../../src/client/components/Layout";
import { initialsOf } from "../../src/client/services/me";
import type { MeDto } from "../../src/shared/api";
import { renderAt, stubApi } from "./harness";

vi.mock("../../src/client/lib/navigate", () => ({ goTo: vi.fn() }));
import { goTo } from "../../src/client/lib/navigate";

beforeEach(() => vi.mocked(goTo).mockClear());

const me = (over: Partial<MeDto["user"]> = {}, tenantName = "Sabertooth Software Labs"): MeDto => ({
  user: { id: "u1", email: "admin@sabertoothsoftwarelabs.net", displayName: "Administrator", access: "Administrator", mustChangePassword: false, ...over },
  tenant: { id: "t1", name: tenantName, slug: "sabertooth-software-labs" },
  session: false,
});

const open = () => renderAt(<Layout />);
const role = () => (screen.getByLabelText("Preview as") as HTMLSelectElement).value;

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

  it("starts the 'Preview as' selector at the user's real access level", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ access: "Campaign Manager" }) } : undefined));
    open();
    await screen.findByText("Sabertooth Software Labs");
    await waitFor(() => expect(role()).toBe("Campaign Manager"));
  });

  it("then leaves the selector to the user: choosing another role sticks", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me({ access: "Viewer" }) } : undefined));
    open();
    await waitFor(() => expect(role()).toBe("Viewer"));
    fireEvent.change(screen.getByLabelText("Preview as"), { target: { value: "Administrator" } });
    expect(role()).toBe("Administrator");
    // a re-render must not snap it back
    fireEvent.click(screen.getByRole("link", { name: "Contacts" }));
    expect(role()).toBe("Administrator");
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

  it("has a Sign out button that ends the session and returns to the login page", async () => {
    const calls = stubApi(({ path, method }) => (path === "/api/me" ? { json: me() } : method === "POST" && path === "/api/auth/logout" ? { status: 204 } : undefined));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("/login"));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/auth/logout")).toBe(true);
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
