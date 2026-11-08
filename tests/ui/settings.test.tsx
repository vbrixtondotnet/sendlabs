// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Settings } from "../../src/client/pages/Settings";
import { ACCESS_LEVELS } from "../../src/shared/types";
import type { InvitationDto } from "../../src/shared/api";
import { invitationDto, page, renderAt, senderDto, senderStatus, stubApi, userDto, type Handler } from "./harness";

const team = [
  userDto(),
  userDto({ id: "u2", email: "mgr@sabertoothsoftwarelabs.net", displayName: "Morgan", access: "Campaign Manager", accessId: "campaign-manager", lastLoginAt: "2026-11-05T15:00:00.000Z" }),
  userDto({ id: "u3", email: "view@sabertoothsoftwarelabs.net", displayName: "", access: "Viewer", accessId: "viewer", status: "Disabled" }),
];
const usersApi = (items = team): Handler => ({ method, path }) =>
  method === "GET" && path === "/api/users" ? { json: page(items) }
  : method === "GET" && path === "/api/users/invitations" ? { json: { items: [] } }
  : method === "GET" && path === "/api/sender" ? { json: senderStatus(null) }
  : undefined;

/** A server with a connected sender and a changing list of invitations. */
function inviteServer(opts: { invitations?: InvitationDto[]; sender?: boolean; reply?: { status: number; json: unknown } } = {}) {
  let open = opts.invitations ?? [];
  const handler: Handler = ({ method, path, body }) => {
    if (method === "GET" && path === "/api/users") return { json: page(team) };
    if (method === "GET" && path === "/api/sender") return { json: senderStatus(opts.sender === false ? null : senderDto()) };
    if (method === "GET" && path === "/api/users/invitations") return { json: { items: open } };
    if (method === "POST" && path === "/api/users/invitations") {
      if (opts.reply) return opts.reply;
      const made = invitationDto({ id: "new1", email: body.email, firstName: body.firstName, lastName: body.lastName, accessId: body.accessId });
      open = [made, ...open];
      return { status: 201, json: made };
    }
    const m = /^\/api\/users\/invitations\/([^/]+)(\/resend)?$/.exec(path);
    if (m && method === "POST" && m[2]) return { status: 201, json: invitationDto({ id: m[1]! }) };
    if (m && method === "DELETE") { open = open.filter((i) => i.id !== m[1]); return { status: 204 }; }
    return undefined;
  };
  return handler;
}
const fillInvite = (v: { first?: string; last?: string; email?: string; role?: string } = {}) => {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: v.first ?? "Pat" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: v.last ?? "Lee" } });
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: v.email ?? "pat@example.test" } });
  if (v.role) fireEvent.change(screen.getByLabelText("Role"), { target: { value: v.role } });
};

const openUsers = () => {
  renderAt(<Settings />);
  fireEvent.click(screen.getByRole("tab", { name: "Users & access" }));
};

describe("Settings tabs", () => {
  it("has the Users & access tab back, in its original place", () => {
    stubApi(usersApi());
    renderAt(<Settings />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Sender", "Sending limits", "Compliance", "Users & access", "Data retention"]);
  });

  it("starts the sender, allowlist and suppression list empty, with no mock records", async () => {
    stubApi(usersApi());
    renderAt(<Settings />);
    expect(await screen.findByText("Not connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeTruthy();
    expect(screen.getByText("No test addresses yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Compliance" }));
    expect(screen.getByText("No suppressed addresses yet.")).toBeTruthy();
    expect((screen.getByLabelText("Sender postal address") as HTMLTextAreaElement).value).toBe("");
    expect(document.body.textContent).not.toMatch(/itimpact|Brian|Dana|Marcus|Priya|iam\.gserviceaccount|karen\.hughes|123 Example Street/);
  });

  it("says plainly that settings are not saved yet, instead of pretending to save", () => {
    stubApi(usersApi());
    renderAt(<Settings />);
    expect(screen.getByText("Preview only")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Sending limits" }));
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    expect(screen.getByText("Not connected yet: nothing was saved")).toBeTruthy();
  });

  it("is for Administrators only, and does not even ask the API for users otherwise", () => {
    const calls = stubApi(usersApi());
    for (const role of ["Campaign Manager", "Viewer"] as const) {
      const view = renderAt(<Settings />, { role });
      expect(screen.getByText("Administrators only")).toBeTruthy();
      expect(screen.queryByRole("tab")).toBeNull();
      view.unmount();
    }
    expect(calls).toHaveLength(0);
  });
});

describe("Users & access tab", () => {
  it("lists the tenant's users from the API, with role, status and last activity", async () => {
    stubApi(usersApi());
    openUsers();
    expect(await screen.findByText("admin@sabertoothsoftwarelabs.net")).toBeTruthy();
    const row = (email: string) => screen.getByText(email).closest("tr")!;

    expect(within(row("admin@sabertoothsoftwarelabs.net")).getByText("Administrator", { selector: "td" })).toBeTruthy();
    expect((within(row("admin@sabertoothsoftwarelabs.net")).getByRole("combobox") as HTMLSelectElement).value).toBe("Administrator");
    expect(within(row("admin@sabertoothsoftwarelabs.net")).getByText("Never")).toBeTruthy(); // has not signed in

    expect((within(row("mgr@sabertoothsoftwarelabs.net")).getByRole("combobox") as HTMLSelectElement).value).toBe("Campaign Manager");
    expect(within(row("mgr@sabertoothsoftwarelabs.net")).queryByText("Never")).toBeNull();
    expect(within(row("mgr@sabertoothsoftwarelabs.net")).getByText("Active")).toBeTruthy();

    expect(within(row("view@sabertoothsoftwarelabs.net")).getByText("Disabled")).toBeTruthy();
    expect(within(row("view@sabertoothsoftwarelabs.net")).getByText("(no name)")).toBeTruthy();
  });

  it("shows no invented people, only what the API returned", async () => {
    stubApi(usersApi([userDto()]));
    openUsers();
    await screen.findByText("admin@sabertoothsoftwarelabs.net");
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + the one real user
    expect(document.body.textContent).not.toMatch(/Brian|Dana L|Marcus T|Priya S|itimpact/);
  });

  it("describes the three access levels from the shared catalog", async () => {
    stubApi(usersApi());
    openUsers();
    await screen.findByText("admin@sabertoothsoftwarelabs.net");
    for (const a of ACCESS_LEVELS) {
      expect(screen.getByText(a.description)).toBeTruthy();
    }
    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Administrator", "Campaign Manager", "Viewer"]);
  });

  it("keeps changing access disabled, and says it is not built", async () => {
    const calls = stubApi(usersApi());
    openUsers();
    await screen.findByText("admin@sabertoothsoftwarelabs.net");
    for (const select of screen.getAllByRole("combobox")) expect((select as HTMLSelectElement).disabled).toBe(true);
    expect(calls.every((c) => c.method === "GET")).toBe(true); // nothing was written
  });

  describe("Remove user", () => {
    /** A server where DELETE removes the user from the list, like the real one. */
    function removeServer(reply?: { status: number; json: unknown }) {
      let items = [...team];
      const handler: Handler = ({ method, path }) => {
        if (method === "GET" && path === "/api/me") return { json: { user: { id: "u1", email: "admin@sabertoothsoftwarelabs.net", displayName: "Administrator", access: "Administrator", mustChangePassword: false }, tenant: { id: "t", name: "Sabertooth Software Labs", slug: "s" }, session: false } };
        if (method === "GET" && path === "/api/users") return { json: page(items) };
        if (method === "GET" && path === "/api/users/invitations") return { json: { items: [] } };
        if (method === "GET" && path === "/api/sender") return { json: senderStatus(senderDto()) };
        const m = /^\/api\/users\/([^/]+)$/.exec(path);
        if (m && method === "DELETE") {
          if (reply) return reply;
          items = items.filter((u) => u.id !== m[1]);
          return { status: 204 };
        }
        return undefined;
      };
      return handler;
    }

    it("offers Remove for other people but not for yourself", async () => {
      stubApi(removeServer());
      openUsers();
      await screen.findByText("mgr@sabertoothsoftwarelabs.net");
      await screen.findByText("You");
      expect(within(screen.getByText("admin@sabertoothsoftwarelabs.net").closest("tr")!).queryByRole("button", { name: /Remove/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Remove Morgan" })).toBeTruthy();
    });

    it("asks first, and removing takes them off the list", async () => {
      const calls = stubApi(removeServer());
      openUsers();
      fireEvent.click(await screen.findByRole("button", { name: "Remove Morgan" }));
      expect(screen.getByText(/can invite them again later/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Keep user" }));
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Remove Morgan" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove user" }));
      expect(await screen.findByText("Morgan was removed")).toBeTruthy();
      expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/users/u2")).toBe(true);
      await waitFor(() => expect(screen.queryByText("mgr@sabertoothsoftwarelabs.net")).toBeNull());
      expect(screen.getByText("admin@sabertoothsoftwarelabs.net")).toBeTruthy();
    });

    it("shows the server's reason when it refuses, and the user stays listed", async () => {
      stubApi(removeServer({ status: 409, json: { error: { code: "LAST_ADMINISTRATOR", message: "At least one active Administrator must remain", correlationId: "x" } } }));
      openUsers();
      fireEvent.click(await screen.findByRole("button", { name: "Remove Morgan" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove user" }));
      expect(await screen.findByText("At least one active Administrator must remain")).toBeTruthy();
      expect(screen.getByText("mgr@sabertoothsoftwarelabs.net")).toBeTruthy();
    });
  });

  describe("Add user", () => {
    it("asks for first name, last name, email and a role, and sends the invitation", async () => {
      const calls = stubApi(inviteServer());
      openUsers();
      await screen.findByText("admin@sabertoothsoftwarelabs.net");
      fireEvent.click(screen.getByRole("button", { name: "Add user" }));

      const role = screen.getByLabelText("Role") as HTMLSelectElement;
      expect([...role.options].map((o) => o.textContent)).toEqual(["Administrator", "Campaign Manager", "Viewer"]);
      expect(role.value).toBe("campaign-manager");
      expect((screen.getByRole("button", { name: "Send invitation" }) as HTMLButtonElement).disabled).toBe(true); // nothing typed yet

      fillInvite({ first: " Pat ", last: "Lee", email: "pat@example.test", role: "viewer" });
      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

      expect(await screen.findByText("Invitation sent to pat@example.test")).toBeTruthy();
      const post = calls.find((c) => c.method === "POST" && c.path === "/api/users/invitations")!;
      expect(post.body).toEqual({ email: "pat@example.test", firstName: "Pat", lastName: "Lee", accessId: "viewer" });
      expect(screen.queryByLabelText("First name")).toBeNull(); // dialog closed
      // the list now shows it as pending
      expect(await screen.findByText("Pending invitations")).toBeTruthy();
      expect(within(screen.getByText("pat@example.test").closest("tr")!).getByText("Pending")).toBeTruthy();
    });

    it("keeps focus in the field while typing (regression: focus jumped away after one character)", async () => {
      stubApi(inviteServer());
      openUsers();
      await screen.findByText("admin@sabertoothsoftwarelabs.net");
      fireEvent.click(screen.getByRole("button", { name: "Add user" }));
      for (const label of ["First name", "Last name", "Email address"]) {
        const input = screen.getByLabelText(label) as HTMLInputElement;
        input.focus();
        for (const text of ["a", "ab", "abc"]) {
          fireEvent.change(input, { target: { value: text } });
          expect(document.activeElement, `${label} after typing "${text}"`).toBe(input);
        }
      }
    });

    it("explains that Gmail must be connected first, and sends nothing", async () => {
      const calls = stubApi(inviteServer({ sender: false }));
      openUsers();
      await screen.findByText("admin@sabertoothsoftwarelabs.net");
      fireEvent.click(screen.getByRole("button", { name: "Add user" }));
      expect(await screen.findByText("Connect Gmail first")).toBeTruthy();
      fillInvite();
      expect((screen.getByRole("button", { name: "Send invitation" }) as HTMLButtonElement).disabled).toBe(true);
      expect(calls.some((c) => c.method === "POST")).toBe(false);
    });

    it("shows the server's reason and keeps what was typed when sending fails", async () => {
      stubApi(inviteServer({ reply: { status: 409, json: { error: { code: "ALREADY_MEMBER", message: "That person is already a user of your account", correlationId: "x" } } } }));
      openUsers();
      await screen.findByText("admin@sabertoothsoftwarelabs.net");
      fireEvent.click(screen.getByRole("button", { name: "Add user" }));
      fillInvite({ email: "mgr@sabertoothsoftwarelabs.net" });
      fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
      expect(await screen.findByText("That person is already a user of your account")).toBeTruthy();
      expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("mgr@sabertoothsoftwarelabs.net");
    });

    it("cancel closes it without sending, and reopening starts blank", async () => {
      const calls = stubApi(inviteServer());
      openUsers();
      await screen.findByText("admin@sabertoothsoftwarelabs.net");
      fireEvent.click(screen.getByRole("button", { name: "Add user" }));
      fillInvite();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByLabelText("First name")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Add user" }));
      expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("");
      expect(calls.some((c) => c.method === "POST")).toBe(false);
    });
  });

  describe("pending invitations", () => {
    it("lists them with status and expiry, and says nothing when there are none", async () => {
      stubApi(inviteServer({ invitations: [invitationDto(), invitationDto({ id: "inv2", email: "old@example.test", status: "Expired" })] }));
      openUsers();
      expect(await screen.findByText("Pending invitations")).toBeTruthy();
      expect(within(screen.getByText("pat@example.test").closest("tr")!).getByText("Pending")).toBeTruthy();
      expect(within(screen.getByText("old@example.test").closest("tr")!).getByText("Expired")).toBeTruthy();

      stubApi(usersApi());
      document.body.innerHTML = "";
      openUsers();
      await screen.findByText("admin@sabertoothsoftwarelabs.net");
      expect(screen.queryByText("Pending invitations")).toBeNull();
    });

    it("resends an invitation", async () => {
      const calls = stubApi(inviteServer({ invitations: [invitationDto()] }));
      openUsers();
      fireEvent.click(await screen.findByRole("button", { name: "Resend invitation to pat@example.test" }));
      expect(await screen.findByText("Invitation sent again to pat@example.test")).toBeTruthy();
      expect(calls.some((c) => c.method === "POST" && c.path === "/api/users/invitations/inv1/resend")).toBe(true);
    });

    it("revokes only after confirming, then removes it from the list", async () => {
      const calls = stubApi(inviteServer({ invitations: [invitationDto()] }));
      openUsers();
      fireEvent.click(await screen.findByRole("button", { name: "Revoke invitation to pat@example.test" }));
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Revoke invitation to pat@example.test" }));
      fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
      await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/users/invitations/inv1")).toBe(true));
      await waitFor(() => expect(screen.queryByText("Pending invitations")).toBeNull());
    });
  });

  it("asks for the first page and pages through the list", async () => {
    const calls = stubApi(({ method, path, query }) =>
      method === "GET" && path === "/api/users" ? { json: page([userDto({ id: `p${query.get("page")}` })], 60, Number(query.get("page")), 25) } : undefined,
    );
    openUsers();
    await screen.findByText("admin@sabertoothsoftwarelabs.net");
    const first = calls.find((c) => c.path === "/api/users")!;
    expect(first.query.get("page")).toBe("1");
    expect(first.query.get("pageSize")).toBe("25");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect([...calls].reverse().find((c) => c.path === "/api/users")!.query.get("page")).toBe("2"));
    expect(screen.getByText("Page 2 / 3")).toBeTruthy();
  });

  it("shows why it could not load, instead of an empty table", async () => {
    stubApi(({ path }) =>
      path === "/api/users" ? { status: 403, json: { error: { code: "FORBIDDEN", message: "Your access level does not allow this", correlationId: "ref-403" } } } : undefined,
    );
    openUsers();
    expect(await screen.findByText("Your access level does not allow this")).toBeTruthy();
    expect(screen.getByText("Reference: ref-403")).toBeTruthy();
    expect(screen.queryByText("Never")).toBeNull();
  });

  it("tells you when the API is not running", async () => {
    stubApi(() => { throw new Error("offline"); });
    openUsers();
    expect(await screen.findByText(/npm run dev:api/)).toBeTruthy();
  });
});
