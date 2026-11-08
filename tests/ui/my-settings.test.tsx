// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { MySettings } from "../../src/client/pages/MySettings";
import type { MeDto } from "../../src/shared/api";
import { renderAt, stubApi, type Call, type Handler } from "./harness";

const meDto = (over: Partial<MeDto["user"]> = {}, postalAddress = ""): MeDto => ({
  user: { id: "u1", email: "ada@acme.test", firstName: "Ada", lastName: "Lovelace", displayName: "Ada Lovelace", access: "Campaign Manager", mustChangePassword: false, ...over },
  tenant: { id: "t", name: "Acme", slug: "acme", postalAddress },
  session: true,
});
const fail = (status: number, code: string, message: string, details?: unknown) => ({ status, json: { error: { code, message, details, correlationId: "x" } } });

/** A server that remembers what was saved, like the real one. */
function server(opts: { profileReply?: ReturnType<typeof fail>; passwordReply?: { status: number; json?: unknown }; tenantReply?: ReturnType<typeof fail>; access?: MeDto["user"]["access"]; postalAddress?: string } = {}): Handler {
  let me = meDto({ access: opts.access ?? "Campaign Manager" }, opts.postalAddress ?? "");
  return ({ method, path, body }: Call) => {
    if (method === "GET" && path === "/api/me") return { json: me };
    if (method === "PATCH" && path === "/api/me") {
      if (opts.profileReply) return opts.profileReply;
      const displayName = `${body.firstName} ${body.lastName}`;
      me = { ...me, user: { ...me.user, ...body, displayName } };
      return { json: { ...body, displayName } };
    }
    if (method === "PATCH" && path === "/api/tenant") {
      if (opts.tenantReply) return opts.tenantReply;
      const postal = typeof body.postalAddress === "string" ? body.postalAddress.split("\n").map((l: string) => l.trim()).filter(Boolean).join("\n") : me.tenant.postalAddress;
      me = { ...me, tenant: { ...me.tenant, name: body.name ?? me.tenant.name, postalAddress: postal } };
      return { json: me.tenant };
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
const area = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const writes = (calls: Call[]) => calls.filter((c) => c.method === "PATCH");

describe("My settings: tabs", () => {
  it("has three tabs, Company Details first, then User Details and Account Details", async () => {
    open(server());
    await screen.findByLabelText("Postal address");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Company Details", "User Details", "Account Details"]);
    expect(screen.getByRole("tab", { name: "Company Details" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByLabelText("First name")).toBeNull();
    expect(screen.queryByLabelText("Current password")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "User Details" }));
    expect(screen.getByLabelText("First name")).toBeTruthy();
    expect(screen.queryByLabelText("Postal address")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Account Details" }));
    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(screen.queryByLabelText("First name")).toBeNull();
  });

  it("the old tab names are gone", async () => {
    open(server());
    await screen.findByLabelText("Postal address");
    expect(screen.queryByRole("tab", { name: "Profile" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Account" })).toBeNull();
  });

  it("can open straight on a given tab", async () => {
    open(server(), "/account?tab=account");
    expect(await screen.findByLabelText("Current password")).toBeTruthy();
  });
});

describe("Company Details tab", () => {
  const save = () => screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;

  it("shows the Name and the Postal address, the address looking like the one on the compliance tab", async () => {
    open(server({ access: "Administrator" }));
    await screen.findByLabelText("Postal address");
    expect(input("Name").value).toBe("Acme");
    expect(area("Postal address").tagName).toBe("TEXTAREA");
    expect(area("Postal address").rows).toBe(2);
    expect(area("Postal address").placeholder).toBe("Company name, street, city, country");
    expect(screen.getByText("Included in the footer of every email.")).toBeTruthy();
  });

  it("is editable for an Administrator", async () => {
    open(server({ access: "Administrator" }));
    await screen.findByLabelText("Postal address");
    for (const el of [input("Name"), area("Postal address")]) {
      expect(el.readOnly).toBe(false);
      expect(el.disabled).toBe(false);
    }
  });

  it.each(["Campaign Manager", "Viewer"] as const)("is read-only for a %s, who sees the saved values, is told why, and has no Save button", async (access) => {
    const calls = open(server({ access, postalAddress: "Acme Inc.\n1 Road" }));
    await screen.findByLabelText("Postal address");
    expect(input("Name").value).toBe("Acme");
    expect(area("Postal address").value).toBe("Acme Inc.\n1 Road");
    for (const el of [input("Name"), area("Postal address")]) {
      expect(el.readOnly).toBe(true);
      expect(el.disabled).toBe(true);
    }
    expect(screen.getByText(/Only an Administrator can change these/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(writes(calls)).toHaveLength(0);
  });

  it("an empty address reads as 'Not set yet' for people who cannot edit it", async () => {
    open(server({ access: "Viewer" }));
    await screen.findByLabelText("Postal address");
    expect(area("Postal address").placeholder).toBe("Not set yet");
  });

  it("cannot be saved until something changed, and never with an empty name", async () => {
    open(server({ access: "Administrator" }));
    await screen.findByLabelText("Postal address");
    expect(save().disabled).toBe(true);
    type("Postal address", "1 Main Street");
    expect(save().disabled).toBe(false);
    type("Postal address", "");
    expect(save().disabled).toBe(true);
    type("Name", "   ");
    type("Postal address", "1 Main Street");
    expect(save().disabled).toBe(true);
  });

  it("saves a multi-line address and sends only what changed", async () => {
    const calls = open(server({ access: "Administrator" }));
    await screen.findByLabelText("Postal address");
    type("Postal address", "Acme Inc.\n100 Main Street\nSpringfield");
    fireEvent.click(save());
    expect(await screen.findByText("Company details updated")).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]!.path).toBe("/api/tenant");
    expect(writes(calls)[0]!.body).toEqual({ postalAddress: "Acme Inc.\n100 Main Street\nSpringfield" }); // no name: it did not change
    expect(area("Postal address").value).toBe("Acme Inc.\n100 Main Street\nSpringfield");
    expect(save().disabled).toBe(true);
  });

  it("renames the company: only the name is sent", async () => {
    const calls = open(server({ access: "Administrator" }));
    await screen.findByLabelText("Postal address");
    type("Name", "  Acme Worldwide ");
    fireEvent.click(save());
    expect(await screen.findByText("Company details updated")).toBeTruthy();
    expect(writes(calls)[0]!.body).toEqual({ name: "Acme Worldwide" });
    expect(input("Name").value).toBe("Acme Worldwide");
  });

  it("changing both sends both in one request", async () => {
    const calls = open(server({ access: "Administrator" }));
    await screen.findByLabelText("Postal address");
    type("Name", "Acme Worldwide");
    type("Postal address", "1 Road");
    fireEvent.click(save());
    await screen.findByText("Company details updated");
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]!.body).toEqual({ name: "Acme Worldwide", postalAddress: "1 Road" });
  });

  it("clearing the address is a change, and saves an empty one", async () => {
    const calls = open(server({ access: "Administrator", postalAddress: "Old address" }));
    await screen.findByLabelText("Postal address");
    expect(area("Postal address").value).toBe("Old address");
    type("Postal address", "");
    fireEvent.click(save());
    await screen.findByText("Company details updated");
    expect(writes(calls)[0]!.body).toEqual({ postalAddress: "" });
  });

  it("retyping the same address with different spacing is not a change", async () => {
    open(server({ access: "Administrator", postalAddress: "Acme Inc.\n1 Road" }));
    await screen.findByLabelText("Postal address");
    type("Postal address", "  Acme   Inc. \r\n\r\n 1 Road ");
    expect(save().disabled).toBe(true);
  });

  it("shows the server's reason under the field when the name is taken, and keeps what was typed", async () => {
    open(server({ access: "Administrator", tenantReply: fail(409, "TENANT_NAME_TAKEN", "That organization name is already in use", [{ path: "name", message: "That organization name is already in use" }]) }));
    await screen.findByLabelText("Postal address");
    type("Name", "Globex Corp");
    type("Postal address", "1 Road");
    fireEvent.click(save());
    expect(await screen.findByText("That organization name is already in use")).toBeTruthy();
    expect(input("Name").value).toBe("Globex Corp");
    expect(area("Postal address").value).toBe("1 Road");
    expect(screen.queryByText("Company details updated")).toBeNull();
  });

  it("shows an address problem under the address field", async () => {
    open(server({ access: "Administrator", tenantReply: fail(400, "VALIDATION_ERROR", "Validation failed", [{ path: "postalAddress", message: "Use at most 500 characters" }]) }));
    await screen.findByLabelText("Postal address");
    type("Postal address", "x");
    fireEvent.click(save());
    expect(await screen.findByText("Use at most 500 characters")).toBeTruthy();
  });

  it("explains an unexpected failure", async () => {
    open(server({ access: "Administrator", tenantReply: fail(500, "INTERNAL", "Something went wrong on our side") }));
    await screen.findByLabelText("Postal address");
    type("Postal address", "x");
    fireEvent.click(save());
    expect(await screen.findByText("Something went wrong on our side")).toBeTruthy();
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

  it("saves the new name, sending only the two names, and never touches the company", async () => {
    const calls = openUser(server({ access: "Administrator" }));
    await screen.findByLabelText("First name");
    type("First name", " Grace ");
    type("Last name", "Hopper");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Profile updated")).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]!.path).toBe("/api/me");
    expect(writes(calls)[0]!.body).toEqual({ firstName: "Grace", lastName: "Hopper" });
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
