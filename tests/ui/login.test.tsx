// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Login } from "../../src/client/pages/Login";
import { safeNext } from "../../src/client/services/auth";
import type { MeDto } from "../../src/shared/api";
import { renderAt, stubApi, type Handler } from "./harness";

vi.mock("../../src/client/lib/navigate", () => ({ goTo: vi.fn() }));
import { goTo } from "../../src/client/lib/navigate";

const signedOut = { status: 401, json: { error: { code: "NO_ACTIVE_USER", message: "Not signed in", correlationId: "x" } } };
const fail = (status: number, code: string, message = "x") => ({ status, json: { error: { code, message, correlationId: "x" } } });
const meDto: MeDto = { user: { id: "u1", email: "a@b.test", firstName: "A", lastName: "B", displayName: "A B", access: "Administrator", mustChangePassword: false }, tenant: { id: "t", name: "T", slug: "t", postalAddress: "" }, session: true };

const open = (handler: Handler, path = "/login") => {
  const calls = stubApi(handler);
  renderAt(<Login />, { path, route: "/login" });
  return calls;
};
const server = (loginReply: { status?: number; json?: unknown } = { json: { redirectTo: "/", mustChangePassword: false } }): Handler => ({ method, path }) => {
  if (method === "GET" && path === "/api/me") return signedOut;
  if (method === "POST" && path === "/api/auth/login") return loginReply;
  return undefined;
};
const type = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
};
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

beforeEach(() => vi.mocked(goTo).mockClear());

describe("the login page", () => {
  it("asks for an email and a password, hides the password, and cannot be submitted empty", async () => {
    open(server());
    await screen.findByRole("heading", { name: "Sign in" });
    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("password");
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(true);
    type("a@b.test", "");
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(true);
    type("a@b.test", "secret");
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("can show the password while typing, and hide it again", async () => {
    open(server());
    await screen.findByRole("heading", { name: "Sign in" });
    const field = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(field.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(field.type).toBe("password");
  });

  it("sends the email and password, then loads the app", async () => {
    const calls = open(server());
    await screen.findByRole("heading", { name: "Sign in" });
    type("  Admin@Example.test ", "Password@123");
    submit();
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("/"));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe("/api/auth/login");
    expect(post.body).toEqual({ email: "Admin@Example.test", password: "Password@123" });
  });

  it("goes back to the page they were heading for", async () => {
    open(server(), "/login?next=%2Fcampaigns%3Ftab%3Dsent");
    await screen.findByRole("heading", { name: "Sign in" });
    type("a@b.test", "pw");
    submit();
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("/campaigns?tab=sent"));
  });

  it("says the same thing for any wrong email or password, clears the password, and stays put", async () => {
    open(server(fail(401, "INVALID_CREDENTIALS", "Incorrect email or password")));
    await screen.findByRole("heading", { name: "Sign in" });
    type("a@b.test", "wrong");
    submit();
    expect(await screen.findByText("Incorrect email or password.")).toBeTruthy();
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("a@b.test"); // email kept for the retry
    expect(goTo).not.toHaveBeenCalled();
  });

  it("tells them how long to wait when locked out", async () => {
    open(server(fail(429, "TOO_MANY_ATTEMPTS", "Too many failed attempts. Try again in 15 minute(s).")));
    await screen.findByRole("heading", { name: "Sign in" });
    type("a@b.test", "wrong");
    submit();
    expect(await screen.findByText("Too many failed attempts. Try again in 15 minute(s).")).toBeTruthy();
  });

  it("explains a disabled account and an unavailable server", async () => {
    open(server(fail(403, "USER_DISABLED", "This account is disabled. Ask an Administrator of your organization.")));
    await screen.findByRole("heading", { name: "Sign in" });
    type("a@b.test", "right");
    submit();
    expect(await screen.findByText(/This account is disabled/)).toBeTruthy();
  });

  it("does not offer to submit twice while signing in", async () => {
    let release: () => void = () => undefined;
    stubApi(({ method, path }) => (method === "GET" && path === "/api/me" ? signedOut : undefined));
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
      const path = new URL(input, "http://localhost").pathname;
      if (path === "/api/me") return Promise.resolve(new Response(JSON.stringify(signedOut.json), { status: 401 }));
      return new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify({ redirectTo: "/", mustChangePassword: false }), { status: 200 })); void init; });
    });
    renderAt(<Login />, { path: "/login", route: "/login" });
    await screen.findByRole("heading", { name: "Sign in" });
    type("a@b.test", "pw");
    submit();
    expect(((await screen.findByRole("button", { name: "Signing in…" })) as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(goTo).toHaveBeenCalledTimes(1));
  });

  it("sends someone who is already signed in straight on, without showing the form", async () => {
    stubApi(({ path }) => (path === "/api/me" ? { json: meDto } : undefined));
    renderAt(<Login />, { path: "/login?next=%2Fcontacts", route: "/login" });
    expect((await screen.findByTestId("elsewhere")).getAttribute("data-location")).toBe("/contacts");
    expect(screen.queryByLabelText("Password")).toBeNull();
  });
});

describe("safeNext", () => {
  it("keeps ordinary in-app paths", () => {
    expect(safeNext("/campaigns")).toBe("/campaigns");
    expect(safeNext("/campaigns?tab=sent")).toBe("/campaigns?tab=sent");
  });

  it("never leaves the app, and never loops back to the login or invitation pages", () => {
    for (const bad of [null, undefined, "", "campaigns", "//evil.test", "https://evil.test", "/\\evil.test", "javascript:alert(1)", "/login", "/login?next=/x", "/invite/abc"]) {
      expect(safeNext(bad), String(bad)).toBe("/");
    }
  });
});
