// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AcceptInvitation } from "../../src/client/pages/AcceptInvitation";
import type { InvitationPreviewDto } from "../../src/shared/api";
import { renderAt, stubApi, type Handler } from "./harness";

vi.mock("../../src/client/lib/navigate", () => ({ goTo: vi.fn() }));
import { goTo } from "../../src/client/lib/navigate";

const TOKEN = "A".repeat(43);
const preview: InvitationPreviewDto = { tenantName: "Sabertooth Software Labs", email: "pat@example.test", firstName: "Pat", lastName: "Lee", access: "Campaign Manager", expiresAt: "2026-11-13T14:30:00.000Z" };
const invalid = { status: 404, json: { error: { code: "INVITATION_INVALID", message: "This invitation link is invalid, has expired, or has already been used", correlationId: "x" } } };

const open = (handler: Handler) => {
  const calls = stubApi(handler);
  renderAt(<AcceptInvitation />, { path: `/invite/${TOKEN}`, route: "/invite/:token" });
  return calls;
};
const ok: Handler = ({ method, path }) => {
  if (method === "GET" && path === `/api/invitations/${TOKEN}`) return { json: preview };
  if (method === "POST" && path === `/api/invitations/${TOKEN}/accept`) return { json: { redirectTo: "/" } };
  return undefined;
};
const type = (password: string, confirm = password) => {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirm } });
};
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

beforeEach(() => vi.mocked(goTo).mockClear());

describe("the invitation page", () => {
  it("greets the person, names the organization and role, and shows their email read-only", async () => {
    open(ok);
    expect(await screen.findByText("Welcome, Pat")).toBeTruthy();
    expect(screen.getByText("Sabertooth Software Labs")).toBeTruthy();
    expect(screen.getByText("Campaign Manager")).toBeTruthy();
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.value).toBe("pat@example.test");
    expect(email.readOnly).toBe(true);
    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("password");
    expect(screen.queryByRole("navigation")).toBeNull(); // not the app's layout
  });

  it("sets the password and sends them to the dashboard", async () => {
    const calls = open(ok);
    await screen.findByText("Welcome, Pat");
    type("a long password");
    submit();
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("/"));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe(`/api/invitations/${TOKEN}/accept`);
    expect(post.body).toEqual({ password: "a long password" }); // only the password: the server knows the rest
  });

  it("will not send a short password or one that does not match, and says why", async () => {
    const calls = open(ok);
    await screen.findByText("Welcome, Pat");
    type("short");
    submit();
    expect(await screen.findByText("Use at least 8 characters")).toBeTruthy();
    type("a long password", "a different one");
    submit();
    expect(await screen.findByText("The passwords do not match.")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(goTo).not.toHaveBeenCalled();
  });

  it("shows the server's message and stays on the page when activating fails", async () => {
    open(({ method, path }) =>
      method === "POST" ? { status: 409, json: { error: { code: "EMAIL_EXISTS", message: "x", correlationId: "x" } } } : ok({ method, path } as never),
    );
    await screen.findByText("Welcome, Pat");
    type("a long password");
    submit();
    expect(await screen.findByText("An account with this email address already exists.")).toBeTruthy();
    expect(goTo).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Activate account" }) as HTMLButtonElement).disabled).toBe(false); // can try again
  });

  it("an expired, used or made-up link gets one plain message and no form", async () => {
    open(() => invalid);
    expect(await screen.findByText("This invitation is no longer valid")).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Sabertooth/);
  });

  it("only ever redirects inside the app, whatever the server says", async () => {
    open(({ method, path }) => (method === "POST" ? { json: { redirectTo: "https://evil.test/" } } : ok({ method, path } as never)));
    await screen.findByText("Welcome, Pat");
    type("a long password");
    submit();
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("/"));
  });
});
