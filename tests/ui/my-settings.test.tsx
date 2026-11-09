// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MySettings } from "../../src/client/pages/MySettings";
import type { MeDto } from "../../src/shared/api";
import { renderAt, stubApi, type Call, type Handler } from "./harness";

const meDto = (over: Partial<MeDto["user"]> = {}): MeDto => ({
  user: { id: "u1", email: "ada@acme.test", firstName: "Ada", lastName: "Lovelace", position: "", displayName: "Ada Lovelace", access: "Campaign Manager", mustChangePassword: false, ...over },
  tenant: { id: "t", name: "Acme", slug: "acme", postalAddress: "", website: "", requireUnsubscribeLink: true, oneClickUnsubscribe: true },
  session: true,
});
const fail = (status: number, code: string, message: string, details?: unknown) => ({ status, json: { error: { code, message, details, correlationId: "x" } } });

/** A server that remembers what was saved, like the real one. */
function server(opts: { profileReply?: ReturnType<typeof fail>; passwordReply?: { status: number; json?: unknown }; access?: MeDto["user"]["access"] } = {}): Handler {
  let me = meDto({ access: opts.access ?? "Campaign Manager" });
  return ({ method, path, body }: Call) => {
    if (method === "GET" && path === "/api/me") return { json: me };
    if (method === "PATCH" && path === "/api/me") {
      if (opts.profileReply) return opts.profileReply;
      const displayName = `${body.firstName} ${body.lastName}`;
      me = { ...me, user: { ...me.user, ...body, displayName } };
      return { json: { ...body, displayName } };
    }
    if (method === "POST" && path === "/api/me/password") return opts.passwordReply ?? { status: 204 };
    return undefined;
  };
}
const open = (handler: Handler, path = "/account") => {
  const calls = stubApi(handler);
  renderAt(<MySettings />, { path, route: "/account" });
  return calls;
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const writes = (calls: Call[]) => calls.filter((c) => c.method === "PATCH");

describe("My settings: tabs", () => {
  it("has two tabs, User Details first and then Account Details", async () => {
    open(server());
    await screen.findByLabelText("First name");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["User Details", "Account Details"]);
    expect(screen.getByRole("tab", { name: "User Details" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByLabelText("Current password")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Account Details" }));
    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(screen.queryByLabelText("First name")).toBeNull();
  });

  it("no longer has Company Details: that lives under Settings, for Administrators", async () => {
    open(server({ access: "Administrator" }));
    await screen.findByLabelText("First name");
    expect(screen.queryByRole("tab", { name: "Company Details" })).toBeNull();
    expect(screen.queryByLabelText("Postal address")).toBeNull();
    expect(screen.queryByLabelText("Website")).toBeNull();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("the old tab names are gone", async () => {
    open(server());
    await screen.findByLabelText("First name");
    expect(screen.queryByRole("tab", { name: "Profile" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Account" })).toBeNull();
  });

  it("can open straight on a given tab, and anything else opens User Details", async () => {
    open(server(), "/account?tab=account");
    expect(await screen.findByLabelText("Current password")).toBeTruthy();
  });

  it("an old link to the Company tab opens User Details instead", async () => {
    open(server(), "/account?tab=company");
    expect(await screen.findByLabelText("First name")).toBeTruthy();
  });
});

describe("User Details tab", () => {
  const openUser = (handler: Handler = server()) => open(handler, "/account?tab=user");

  it("shows the current first and last name, and the email and role read-only", async () => {
    openUser();
    await screen.findByLabelText("First name");
    expect(input("First name").value).toBe("Ada");
    expect(input("Last name").value).toBe("Lovelace");
    expect(input("Email address").value).toBe("ada@acme.test");
    expect(input("Email address").readOnly).toBe(true);
    expect(input("Role").value).toBe("Campaign Manager");
    expect(input("Role").readOnly).toBe(true);
  });

  it("has a Position field, empty until it is set, and an optional one", async () => {
    openUser();
    await screen.findByLabelText("Position");
    expect(input("Position").value).toBe("");
    expect(input("Position").readOnly).toBe(false);
    expect(input("Position").disabled).toBe(false);
    expect(input("Position").maxLength).toBe(100);
    expect(screen.getByText(/Optional/)).toBeTruthy();
  });

  it("shows the saved position", async () => {
    openUser(() => ({ json: meDto({ access: "Viewer", position: "Sales Director" }) }));
    await screen.findByLabelText("Position");
    expect(input("Position").value).toBe("Sales Director");
  });

  it("saves a changed position on its own, and it counts as a change", async () => {
    const calls = openUser();
    await screen.findByLabelText("Position");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    type("Position", "  Head of Sales ");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Profile updated")).toBeTruthy();
    expect(writes(calls)[0]!.body).toEqual({ firstName: "Ada", lastName: "Lovelace", position: "Head of Sales" });
    expect(input("Position").value).toBe("Head of Sales");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true); // saved: nothing left to save
  });

  it("can be cleared again, and is allowed to be empty", async () => {
    const calls = openUser((c) => (c.method === "GET" ? { json: meDto({ access: "Viewer", position: "CTO" }) } : { json: { firstName: "Ada", lastName: "Lovelace", position: "", displayName: "Ada Lovelace" } }));
    await screen.findByLabelText("Position");
    type("Position", "");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body.position).toBe("");
  });

  it("shows the server's reason under the field, and keeps what was typed", async () => {
    openUser(server({ profileReply: fail(400, "VALIDATION_ERROR", "Validation failed", [{ path: "position", message: "Use at most 100 characters" }]) }));
    await screen.findByLabelText("Position");
    type("Position", "something");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Use at most 100 characters")).toBeTruthy();
    expect(input("Position").value).toBe("something");
  });

  it("no longer carries the organization name", async () => {
    openUser(server({ access: "Administrator" }));
    await screen.findByLabelText("First name");
    expect(screen.queryByLabelText("Organization name")).toBeNull();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("cannot be saved until something changed, and not with an empty name", async () => {
    openUser();
    await screen.findByLabelText("First name");
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    type("First name", "Grace");
    expect(save.disabled).toBe(false);
    type("Last name", "  ");
    expect(save.disabled).toBe(true);
    type("Last name", "Lovelace");
    type("First name", "Ada");
    expect(save.disabled).toBe(true);
  });

  it("saves the new name, sending the names and position only, and never touches the company", async () => {
    const calls = openUser(server({ access: "Administrator" }));
    await screen.findByLabelText("First name");
    type("First name", " Grace ");
    type("Last name", "Hopper");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Profile updated")).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]!.path).toBe("/api/me");
    expect(writes(calls)[0]!.body).toEqual({ firstName: "Grace", lastName: "Hopper", position: "" });
    expect(input("First name").value).toBe("Grace");
  });

  it("shows what the server said when it refuses, and keeps what was typed", async () => {
    openUser(server({ profileReply: fail(400, "VALIDATION_ERROR", "Validation failed", [{ path: "firstName", message: "First name is required" }]) }));
    await screen.findByLabelText("First name");
    type("First name", "Grace");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("First name is required")).toBeTruthy();
    expect(input("First name").value).toBe("Grace");
  });

  it("shows an unexpected failure plainly", async () => {
    openUser(server({ profileReply: fail(500, "INTERNAL", "Something went wrong on our side") }));
    await screen.findByLabelText("First name");
    type("First name", "Grace");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Something went wrong on our side")).toBeTruthy();
  });
});

describe("Account Details tab", () => {
  const openAccount = (handler: Handler = server()) => open(handler, "/account?tab=account");
  const fill = (current = "old-password-1", next = "new-password-2", confirm = next) => {
    type("Current password", current);
    type("New password", next);
    type("Confirm new password", confirm);
  };
  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Change password" }));

  it("asks for the current password, the new one, and the new one again, all hidden", async () => {
    openAccount();
    await screen.findByLabelText("Current password");
    for (const l of ["Current password", "New password", "Confirm new password"]) expect(input(l).type).toBe("password");
    expect((screen.getByRole("button", { name: "Change password" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("changes the password, sends only the two passwords, and clears the form", async () => {
    const calls = openAccount();
    await screen.findByLabelText("Current password");
    fill();
    submit();
    expect(await screen.findByText("Password changed. Your other devices were signed out.")).toBeTruthy();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe("/api/me/password");
    expect(post.body).toEqual({ currentPassword: "old-password-1", newPassword: "new-password-2" });
    for (const l of ["Current password", "New password", "Confirm new password"]) expect(input(l).value).toBe("");
  });

  it("will not send a short password, a mismatch, or the same password again, and says why", async () => {
    const calls = openAccount();
    await screen.findByLabelText("Current password");
    fill("old-password-1", "short");
    submit();
    expect(await screen.findByText("Use at least 8 characters")).toBeTruthy();
    fill("old-password-1", "new-password-2", "different-3");
    submit();
    expect(await screen.findByText("The passwords do not match.")).toBeTruthy();
    fill("old-password-1", "old-password-1");
    submit();
    expect(await screen.findByText("Choose a password different from your current one")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("tells you when the current password is wrong, under that field, and clears it", async () => {
    openAccount(server({ passwordReply: fail(400, "INVALID_CURRENT_PASSWORD", "Your current password is not correct", [{ path: "currentPassword", message: "Your current password is not correct" }]) }));
    await screen.findByLabelText("Current password");
    fill();
    submit();
    expect(await screen.findByText("Your current password is not correct")).toBeTruthy();
    expect(input("Current password").value).toBe("");
    expect(input("New password").value).toBe("new-password-2");
  });

  it("says how long to wait when locked", async () => {
    openAccount(server({ passwordReply: fail(429, "TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Try again in 15 minute(s).") }));
    await screen.findByLabelText("Current password");
    fill();
    submit();
    expect(await screen.findByText("Too many incorrect attempts. Try again in 15 minute(s).")).toBeTruthy();
  });

  it("does not submit twice while changing", async () => {
    const calls = openAccount();
    await screen.findByLabelText("Current password");
    fill();
    const form = screen.getByLabelText("Current password").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await screen.findByText("Password changed. Your other devices were signed out.");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
});

describe("loading and failure", () => {
  it("shows an error, not an empty form, when the user cannot be loaded", async () => {
    open(() => fail(500, "INTERNAL", "Something went wrong on our side"));
    expect(await screen.findByText("Something went wrong on our side")).toBeTruthy();
    expect(screen.queryByLabelText("Postal address")).toBeNull();
  });
});
