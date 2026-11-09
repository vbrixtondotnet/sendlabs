// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Settings } from "../../src/client/pages/Settings";
import { ACCESS_LEVELS } from "../../src/shared/types";
import type { InvitationDto } from "../../src/shared/api";
import type { MeDto, SuppressionDto } from "../../src/shared/api";
import { invitationDto, meDto, page, renderAt, senderDto, senderStatus, stubApi, testRecipientDto, userDto, type Call, type Handler } from "./harness";

const team = [
  userDto(),
  userDto({ id: "u2", email: "mgr@sabertoothsoftwarelabs.net", displayName: "Morgan", access: "Campaign Manager", accessId: "campaign-manager", lastLoginAt: "2026-11-05T15:00:00.000Z" }),
  userDto({ id: "u3", email: "view@sabertoothsoftwarelabs.net", displayName: "", access: "Viewer", accessId: "viewer", status: "Disabled" }),
];
const usersApi = (items = team): Handler => ({ method, path }) =>
  method === "GET" && path === "/api/users" ? { json: page(items) }
  : method === "GET" && path === "/api/users/invitations" ? { json: { items: [] } }
  : method === "GET" && path === "/api/sender" ? { json: senderStatus(null) }
  : method === "GET" && path === "/api/test-recipients" ? { json: { items: [] } }
  : method === "GET" && path === "/api/me" ? { json: meDto() }
  : method === "GET" && path === "/api/suppressions" ? { json: page([]) }
  : undefined;

/** A server with a connected sender and a changing list of invitations. */
function inviteServer(opts: { invitations?: InvitationDto[]; sender?: boolean; reply?: { status: number; json: unknown } } = {}) {
  let open = opts.invitations ?? [];
  const handler: Handler = ({ method, path, body }) => {
    if (method === "GET" && path === "/api/users") return { json: page(team) };
    if (method === "GET" && path === "/api/sender") return { json: senderStatus(opts.sender === false ? null : senderDto()) };
    if (method === "GET" && path === "/api/users/invitations") return { json: { items: open } };
    if (method === "GET" && path === "/api/test-recipients") return { json: { items: [] } };
    if (method === "GET" && path === "/api/me") return { json: meDto() };
    if (method === "GET" && path === "/api/suppressions") return { json: page([]) };
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

/** Opens Settings and goes to the Email Service tab, where the Gmail sender, test-send list and unsubscribe rules are. */
const openEmailService = () => {
  renderAt(<Settings />);
  fireEvent.click(screen.getByRole("tab", { name: "Email Service" }));
};

const openUsers = () => {
  renderAt(<Settings />);
  fireEvent.click(screen.getByRole("tab", { name: "Users & access" }));
};

describe("Settings tabs", () => {
  it("has three tabs, in this order: Company Details, Users & access, Email Service", () => {
    stubApi(usersApi());
    renderAt(<Settings />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Company Details", "Users & access", "Email Service"]);
    expect(screen.getByRole("tab", { name: "Company Details" }).getAttribute("aria-selected")).toBe("true"); // opens on the first
  });

  it("no longer has the Compliance, Sender, Sending limits or Data retention tabs", () => {
    stubApi(usersApi());
    renderAt(<Settings />);
    for (const name of ["Compliance", "Sender", "Sending limits", "Data retention"]) expect(screen.queryByRole("tab", { name }), name).toBeNull();
  });

  it("opens on Email Service when Google sends the browser back from Connect Gmail", async () => {
    stubApi(usersApi());
    renderAt(<Settings />, { path: "/settings?sender=connected", route: "/settings" });
    expect(screen.getByRole("tab", { name: "Email Service" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("Gmail sender")).toBeTruthy();
  });

  it("puts everything about sending email on Email Service: sender, test-send list, unsubscribe rules, limits, suppression list and retention", async () => {
    stubApi(usersApi());
    openEmailService();
    expect(await screen.findByText("Gmail sender")).toBeTruthy();
    expect(screen.getByText("Test-send allowlist")).toBeTruthy();
    expect(await screen.findByText("Unsubscribe and compliance")).toBeTruthy();
    expect(screen.getByText("Default sending limits")).toBeTruthy();
    expect(screen.getByText("Suppression list")).toBeTruthy();
    expect(screen.getByText("Data retention")).toBeTruthy();
    expect(screen.getByLabelText("Max emails per day")).toBeTruthy();
    expect(screen.getByLabelText("Delete uploaded CSV files after (days)")).toBeTruthy();
  });

  describe("layout of the Email Service tab", () => {
    const TITLES = ["Gmail sender", "Test-send allowlist", "Unsubscribe and compliance", "Default sending limits", "Suppression list", "Data retention"];
    const cardOf = (title: string) => screen.getByText(title, { selector: "h2" }).closest(".rounded-xl") as HTMLElement;

    it("lays every section out as an equal cell of one two-column grid, so they all have the same width", async () => {
      stubApi(usersApi());
      openEmailService();
      await screen.findByText("Unsubscribe and compliance");
      const cards = TITLES.map(cardOf);
      const grid = cards[0]!.parentElement!;
      expect(grid.className).toContain("lg:grid-cols-2");
      for (const [i, c] of cards.entries()) {
        expect(c.parentElement, TITLES[i]).toBe(grid); // all in the same grid, none nested or in its own box
        expect(c.className, TITLES[i]).not.toMatch(/max-w-/); // no section is narrower than the others
      }
    });

    it("puts Unsubscribe and compliance next to Default sending limits, and Suppression list next to Data retention", async () => {
      stubApi(usersApi());
      openEmailService();
      await screen.findByText("Unsubscribe and compliance");
      const cells = [...cardOf("Gmail sender").parentElement!.children].filter((el) => el.classList.contains("rounded-xl"));
      const order = cells.map((c) => c.querySelector("h2")!.textContent);
      // Gmail | test-send  /  unsubscribe | limits  /  suppression | retention, two to a row
      expect(order).toEqual(TITLES);
      expect(order.length % 2).toBe(0);
      expect(order.indexOf("Default sending limits") - order.indexOf("Unsubscribe and compliance")).toBe(1);
      expect(order.indexOf("Unsubscribe and compliance") % 2).toBe(0); // first of its row
      expect(order.indexOf("Data retention") - order.indexOf("Suppression list")).toBe(1);
      expect(order.indexOf("Suppression list") % 2).toBe(0);
    });

    it("keeps the explanation of the Gmail connection on a full-width row of its own", async () => {
      stubApi(usersApi());
      openEmailService();
      await screen.findByText("Unsubscribe and compliance");
      const note = screen.getByText(/stores a secure, encrypted key/).closest("div.lg\\:col-span-2");
      expect(note).toBeTruthy();
    });

    it("still shows the unsubscribe card at the same size while it is loading", async () => {
      vi.stubGlobal("fetch", (input: string) => (input === "/api/me" ? new Promise(() => undefined) : Promise.resolve(new Response(JSON.stringify(input === "/api/sender" ? senderStatus(null) : { items: [] }), { status: 200, headers: { "content-type": "application/json" } }))));
      openEmailService();
      await screen.findByText("Gmail sender");
      const placeholder = document.querySelector(".lg\\:grid-cols-2 > .rounded-xl:not(:has(h2))");
      expect(placeholder).toBeTruthy();
      expect(placeholder!.className).not.toMatch(/max-w-/);
    });
  });

  it("starts the sender, allowlist and suppression list empty, with no mock records", async () => {
    stubApi(usersApi());
    openEmailService();
    expect(await screen.findByText("Not connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeTruthy();
    expect(await screen.findByText(/No test addresses yet/)).toBeTruthy();
    expect(screen.getByText("No suppressed addresses yet.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/itimpact|Brian|Dana|Marcus|Priya|iam\.gserviceaccount|karen\.hughes|123 Example Street/);
  });

  it("has no separate sender postal address any more: the company's postal address is used", async () => {
    stubApi(usersApi());
    openEmailService();
    await screen.findByText("Unsubscribe and compliance");
    expect(screen.queryByLabelText("Sender postal address")).toBeNull();
    expect(screen.queryByText("Required before launch")).toBeNull();
  });

  it("says plainly that limits and retention are not saved yet, instead of pretending to save", async () => {
    stubApi(usersApi());
    openEmailService();
    expect(screen.getByText("Preview only")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    expect(screen.getByText("Not connected yet: nothing was saved")).toBeTruthy();
  });

  it("is for Administrators only: anyone else is sent back to the start page, and the API is never asked", () => {
    const calls = stubApi(usersApi());
    for (const role of ["Campaign Manager", "Viewer"] as const) {
      const view = renderAt(<Settings />, { role, path: "/settings", route: "/settings" });
      expect(screen.getByTestId("elsewhere").getAttribute("data-location")).toBe("/");
      expect(screen.queryByRole("tab")).toBeNull();
      expect(screen.queryByText("Settings")).toBeNull();
      view.unmount();
    }
    expect(calls).toHaveLength(0);
  });

  it("stays on the page for an Administrator", () => {
    stubApi(usersApi());
    renderAt(<Settings />, { path: "/settings", route: "/settings" });
    expect(screen.queryByTestId("elsewhere")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});

describe("Company Details tab", () => {
  const tenant = (over: Partial<MeDto["tenant"]> = {}): MeDto["tenant"] => ({ id: "t", name: "Acme", slug: "acme", postalAddress: "", website: "", requireUnsubscribeLink: true, oneClickUnsubscribe: true, ...over });
  const fail = (status: number, code: string, message: string, details?: unknown) => ({ status, json: { error: { code, message, details, correlationId: "x" } } });

  /** A server that remembers what was saved, like the real one. */
  function companyServer(opts: { tenant?: Partial<MeDto["tenant"]>; reply?: ReturnType<typeof fail> } = {}): Handler {
    let me: MeDto = { user: { id: "u1", email: "a@acme.test", firstName: "A", lastName: "B", position: "", displayName: "A B", access: "Administrator", mustChangePassword: false }, tenant: tenant(opts.tenant), session: true };
    return ({ method, path, body }) => {
      if (method === "GET" && path === "/api/me") return { json: me };
      if (method === "GET" && path === "/api/sender") return { json: senderStatus(null) };
      if (method === "GET" && path === "/api/test-recipients") return { json: { items: [] } };
      if (method === "PATCH" && path === "/api/tenant") {
        if (opts.reply) return opts.reply;
        const postal = typeof body.postalAddress === "string" ? body.postalAddress.split("\n").map((l: string) => l.trim()).filter(Boolean).join("\n") : me.tenant.postalAddress;
        me = { ...me, tenant: { ...me.tenant, name: body.name ?? me.tenant.name, website: body.website ?? me.tenant.website, postalAddress: postal } };
        return { json: me.tenant };
      }
      return undefined;
    };
  }
  const openCompany = async (handler: Handler = companyServer()) => {
    const calls = stubApi(handler);
    renderAt(<Settings />);
    fireEvent.click(screen.getByRole("tab", { name: "Company Details" }));
    await screen.findByLabelText("Postal address");
    return calls;
  };
  const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  const area = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const save = () => screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
  const patches = (calls: Call[]) => calls.filter((c) => c.method === "PATCH");

  it("shows Name, Website and Postal address, filled in with what is saved", async () => {
    await openCompany(companyServer({ tenant: { name: "Acme", website: "acme.test", postalAddress: "Acme Inc.\n1 Road" } }));
    expect(input("Name").value).toBe("Acme");
    expect(input("Website").value).toBe("acme.test");
    expect(area("Postal address").value).toBe("Acme Inc.\n1 Road");
  });

  it("lays the fields out like the compliance tab's postal address: a two-row box with the same placeholder", async () => {
    await openCompany();
    expect(area("Postal address").tagName).toBe("TEXTAREA");
    expect(area("Postal address").rows).toBe(2);
    expect(area("Postal address").placeholder).toBe("Company name, street, city, country");
    expect(input("Website").placeholder).toBe("example.com");
    expect(screen.getByText("Included in the footer of every email.")).toBeTruthy();
  });

  it("is editable, and an empty website is fine", async () => {
    await openCompany();
    for (const el of [input("Name"), input("Website"), area("Postal address")]) {
      expect(el.readOnly).toBe(false);
      expect(el.disabled).toBe(false);
    }
    expect(input("Website").value).toBe("");
  });

  it("cannot be saved until something changed, and never with an empty name", async () => {
    await openCompany();
    expect(save().disabled).toBe(true);
    type("Website", "acme.test");
    expect(save().disabled).toBe(false);
    type("Website", "");
    expect(save().disabled).toBe(true);
    type("Name", "   ");
    type("Website", "acme.test");
    expect(save().disabled).toBe(true);
  });

  it("saves a new website and sends only the website", async () => {
    const calls = await openCompany();
    type("Website", "  sabertoothsoftwarelabs.net ");
    fireEvent.click(save());
    expect(await screen.findByText("Company details updated")).toBeTruthy();
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]!.path).toBe("/api/tenant");
    expect(patches(calls)[0]!.body).toEqual({ website: "sabertoothsoftwarelabs.net" });
    expect(input("Website").value).toBe("sabertoothsoftwarelabs.net");
    expect(save().disabled).toBe(true);
  });

  it("can clear the website again", async () => {
    const calls = await openCompany(companyServer({ tenant: { website: "old.test" } }));
    type("Website", "");
    fireEvent.click(save());
    await screen.findByText("Company details updated");
    expect(patches(calls)[0]!.body).toEqual({ website: "" });
  });

  it("saves a multi-line address and sends only what changed", async () => {
    const calls = await openCompany();
    type("Postal address", "Acme Inc.\n100 Main Street\nSpringfield");
    fireEvent.click(save());
    expect(await screen.findByText("Company details updated")).toBeTruthy();
    expect(patches(calls)[0]!.body).toEqual({ postalAddress: "Acme Inc.\n100 Main Street\nSpringfield" });
    expect(save().disabled).toBe(true);
  });

  it("renames the company: only the name is sent", async () => {
    const calls = await openCompany();
    type("Name", "  Acme Worldwide ");
    fireEvent.click(save());
    expect(await screen.findByText("Company details updated")).toBeTruthy();
    expect(patches(calls)[0]!.body).toEqual({ name: "Acme Worldwide" });
    expect(input("Name").value).toBe("Acme Worldwide");
  });

  it("changing everything sends everything in one request", async () => {
    const calls = await openCompany();
    type("Name", "Acme Worldwide");
    type("Website", "acme.test");
    type("Postal address", "1 Road");
    fireEvent.click(save());
    await screen.findByText("Company details updated");
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]!.body).toEqual({ name: "Acme Worldwide", website: "acme.test", postalAddress: "1 Road" });
  });

  it("clearing the address is a change, and saves an empty one", async () => {
    const calls = await openCompany(companyServer({ tenant: { postalAddress: "Old address" } }));
    type("Postal address", "");
    fireEvent.click(save());
    await screen.findByText("Company details updated");
    expect(patches(calls)[0]!.body).toEqual({ postalAddress: "" });
  });

  it("retyping the same address with different spacing is not a change", async () => {
    await openCompany(companyServer({ tenant: { postalAddress: "Acme Inc.\n1 Road" } }));
    type("Postal address", "  Acme   Inc. \r\n\r\n 1 Road ");
    expect(save().disabled).toBe(true);
  });

  it("shows the server's reason under the website, and keeps what was typed", async () => {
    await openCompany(companyServer({ reply: fail(400, "VALIDATION_ERROR", "Validation failed", [{ path: "website", message: "Enter a website such as example.com" }]) }));
    type("Website", "not a website");
    fireEvent.click(save());
    expect(await screen.findByText("Enter a website such as example.com")).toBeTruthy();
    expect(input("Website").value).toBe("not a website");
    expect(screen.queryByText("Company details updated")).toBeNull();
  });

  it("shows the server's reason under the name when it is taken", async () => {
    await openCompany(companyServer({ reply: fail(409, "TENANT_NAME_TAKEN", "That organization name is already in use", [{ path: "name", message: "That organization name is already in use" }]) }));
    type("Name", "Globex Corp");
    fireEvent.click(save());
    expect(await screen.findByText("That organization name is already in use")).toBeTruthy();
    expect(input("Name").value).toBe("Globex Corp");
  });

  it("shows an address problem under the address field", async () => {
    await openCompany(companyServer({ reply: fail(400, "VALIDATION_ERROR", "Validation failed", [{ path: "postalAddress", message: "Use at most 500 characters" }]) }));
    type("Postal address", "x");
    fireEvent.click(save());
    expect(await screen.findByText("Use at most 500 characters")).toBeTruthy();
  });

  it("explains an unexpected failure", async () => {
    await openCompany(companyServer({ reply: fail(500, "INTERNAL", "Something went wrong on our side") }));
    type("Name", "Other");
    fireEvent.click(save());
    expect(await screen.findByText("Something went wrong on our side")).toBeTruthy();
  });
});

describe("Test-send allowlist", () => {
  /** A server that keeps the list, as the real one does. */
  function allowlistServer(initial = [testRecipientDto()], reply?: { status: number; json: unknown }) {
    let items = initial;
    const handler: Handler = ({ method, path, body }) => {
      if (method === "GET" && path === "/api/sender") return { json: senderStatus(null) };
      if (method === "GET" && path === "/api/me") return { json: meDto() };
      if (method === "GET" && path === "/api/suppressions") return { json: page([]) };
      if (method === "GET" && path === "/api/test-recipients") return { json: { items } };
      if (method === "POST" && path === "/api/test-recipients") {
        if (reply) return reply;
        const made = testRecipientDto({ id: `n${items.length + 1}`, email: body.email });
        items = [...items, made];
        return { status: 201, json: made };
      }
      const m = /^\/api\/test-recipients\/([^/]+)$/.exec(path);
      if (m && method === "DELETE") { items = items.filter((i) => i.id !== m[1]); return { status: 204 }; }
      return undefined;
    };
    return handler;
  }
  const address = () => screen.getByLabelText("Add test address") as HTMLInputElement;

  it("lists the saved addresses from the server", async () => {
    stubApi(allowlistServer([testRecipientDto(), testRecipientDto({ id: "t2", email: "pm@acme.test" })]));
    openEmailService();
    expect(await screen.findByText("qa@acme.test")).toBeTruthy();
    expect(screen.getByText("pm@acme.test")).toBeTruthy();
    expect(screen.queryByText(/No test addresses yet/)).toBeNull();
  });

  it("adds an address for real: it is sent to the server, listed afterwards, and the box is cleared", async () => {
    const calls = stubApi(allowlistServer([]));
    openEmailService();
    await screen.findByText(/No test addresses yet/);
    fireEvent.change(address(), { target: { value: "  New@Acme.test " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("New@Acme.test")).toBeTruthy();
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/test-recipients")!.body).toEqual({ email: "New@Acme.test" });
    expect(address().value).toBe("");
    expect(screen.queryByText("Not connected yet: nothing was saved")).toBeNull();
  });

  it("adds on Enter", async () => {
    const calls = stubApi(allowlistServer([]));
    openEmailService();
    await screen.findByText(/No test addresses yet/);
    fireEvent.change(address(), { target: { value: "enter@acme.test" } });
    fireEvent.submit(address().closest("form")!);
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
  });

  it("does nothing for a blank box", async () => {
    const calls = stubApi(allowlistServer([]));
    openEmailService();
    await screen.findByText(/No test addresses yet/);
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(address(), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows the server's reason (bad address, duplicate) and keeps what was typed", async () => {
    stubApi(allowlistServer([], { status: 409, json: { error: { code: "TEST_RECIPIENT_EXISTS", message: "That address is already on the list", details: [{ path: "email", message: "That address is already on the list" }], correlationId: "x" } } }));
    openEmailService();
    await screen.findByText(/No test addresses yet/);
    fireEvent.change(address(), { target: { value: "dup@acme.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That address is already on the list");
    expect(address().value).toBe("dup@acme.test");
  });

  it("removes an address on the server", async () => {
    const calls = stubApi(allowlistServer([testRecipientDto(), testRecipientDto({ id: "t2", email: "pm@acme.test" })]));
    openEmailService();
    await screen.findByText("qa@acme.test");
    fireEvent.click(screen.getByRole("button", { name: "Remove qa@acme.test" }));
    await waitFor(() => expect(screen.queryByText("qa@acme.test")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/test-recipients/t1")).toBe(true);
    expect(screen.getByText("pm@acme.test")).toBeTruthy();
  });

  it("says why it could not load, instead of looking empty", async () => {
    stubApi(({ method, path }) =>
      method === "GET" && path === "/api/sender" ? { json: senderStatus(null) }
        : path === "/api/test-recipients" ? { status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Something went wrong", correlationId: "ref-9" } } }
        : undefined,
    );
    openEmailService();
    expect(await screen.findByText("Reference: ref-9")).toBeTruthy();
    expect(screen.queryByText(/No test addresses yet/)).toBeNull();
  });
});

describe("Users & access tab", () => {
  it("shows each user's position, and a dash where none is set", async () => {
    stubApi(usersApi([userDto({ position: "Sales Director" }), userDto({ id: "u2", email: "mgr@sabertoothsoftwarelabs.net", displayName: "Morgan", position: "" })]));
    openUsers();
    expect(await screen.findByText("admin@sabertoothsoftwarelabs.net")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Position" })).toBeTruthy();
    const row = (email: string) => screen.getByText(email).closest("tr")!;
    expect(within(row("admin@sabertoothsoftwarelabs.net")).getByText("Sales Director")).toBeTruthy();
    expect(within(row("mgr@sabertoothsoftwarelabs.net")).getByText("-")).toBeTruthy();
  });

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
      expect(post.body).toEqual({ email: "pat@example.test", firstName: "Pat", lastName: "Lee", position: "", accessId: "viewer" });
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
    expect((await screen.findAllByText(/npm run dev:api/)).length).toBeGreaterThan(0); // the users list, and the invitations list
  });
});

describe("Add user: position", () => {
  const openAdd = (handler: Handler = inviteServer()) => {
    const calls = stubApi(handler);
    openUsers();
    return calls;
  };
  const clickAdd = async () => {
    await screen.findByText("admin@sabertoothsoftwarelabs.net");
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    await screen.findByLabelText("First name");
  };

  it("has an optional Position field, and the form is complete without it", async () => {
    openAdd();
    await clickAdd();
    const position = screen.getByLabelText("Position") as HTMLInputElement;
    expect(position.value).toBe("");
    expect(position.maxLength).toBe(100);
    expect(screen.getByText(/Optional; they can change it themselves later/)).toBeTruthy();
    fillInvite();
    expect((screen.getByRole("button", { name: "Send invitation" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends the position with the invitation, trimmed", async () => {
    const calls = openAdd();
    await clickAdd();
    fillInvite();
    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "  Sales Director " } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/users/invitations")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ email: "pat@example.test", firstName: "Pat", lastName: "Lee", position: "Sales Director", accessId: "campaign-manager" });
  });

  it("sends an empty position when none was typed", async () => {
    const calls = openAdd();
    await clickAdd();
    fillInvite();
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.position).toBe("");
  });

  it("starts empty again the next time the dialog opens", async () => {
    openAdd();
    await clickAdd();
    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "Leftover" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    expect((await screen.findByLabelText("Position") as HTMLInputElement).value).toBe("");
  });

  it("shows the position in the pending invitations list, and a dash where there is none", async () => {
    openAdd(inviteServer({ invitations: [invitationDto({ position: "Sales Director" }), invitationDto({ id: "inv2", email: "old@example.test", position: "" })] }));
    expect(await screen.findByText("Pending invitations")).toBeTruthy();
    const row = (email: string) => screen.getByText(email).closest("tr")!;
    expect(within(row("pat@example.test")).getByText("Sales Director")).toBeTruthy();
    expect(within(row("old@example.test")).getByText("-")).toBeTruthy();
  });
});

describe("Unsubscribe and compliance (Email Service tab)", () => {
  const fail = (status: number, code: string, message: string) => ({ status, json: { error: { code, message, correlationId: "x" } } });

  /** A server that remembers what was saved, like the real one. */
  function complianceServer(opts: { tenant?: Partial<MeDto["tenant"]>; reply?: ReturnType<typeof fail> } = {}): Handler {
    let me = meDto({}, opts.tenant);
    return ({ method, path, body }) => {
      if (method === "GET" && path === "/api/me") return { json: me };
      if (method === "GET" && path === "/api/sender") return { json: senderStatus(null) };
      if (method === "GET" && path === "/api/test-recipients") return { json: { items: [] } };
      if (method === "GET" && path === "/api/suppressions") return { json: page([]) };
      if (method === "PATCH" && path === "/api/tenant") {
        if (opts.reply) return opts.reply;
        me = { ...me, tenant: { ...me.tenant, ...body } };
        return { json: me.tenant };
      }
      return undefined;
    };
  }
  const open = async (handler: Handler = complianceServer()) => {
    const calls = stubApi(handler);
    openEmailService();
    await screen.findByText("Unsubscribe and compliance");
    await screen.findByLabelText("Require an unsubscribe link in every campaign");
    return calls;
  };
  const requireBox = () => screen.getByLabelText("Require an unsubscribe link in every campaign") as HTMLInputElement;
  const oneClickBox = () => screen.getByLabelText("Add one-click List-Unsubscribe headers") as HTMLInputElement;
  /** The card itself: the Data retention card has a Save button too. */
  const card = () => screen.getByText("Unsubscribe and compliance").closest(".rounded-xl") as HTMLElement;
  const save = () => within(card()).getByRole("button", { name: "Save" }) as HTMLButtonElement;
  const patches = (calls: Call[]) => calls.filter((c) => c.method === "PATCH");

  it("has both options ticked by default", async () => {
    await open();
    expect(requireBox().checked).toBe(true);
    expect(oneClickBox().checked).toBe(true);
    expect(save().disabled).toBe(true); // nothing to save yet
  });

  it("shows what is saved when one is off", async () => {
    await open(complianceServer({ tenant: { requireUnsubscribeLink: false } }));
    expect(requireBox().checked).toBe(false);
    expect(oneClickBox().checked).toBe(true);
  });

  it("saves a change for real, sending only what changed, and then has nothing left to save", async () => {
    const calls = await open();
    fireEvent.click(oneClickBox());
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    expect(await screen.findByText("Unsubscribe settings updated")).toBeTruthy();
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]!.path).toBe("/api/tenant");
    expect(patches(calls)[0]!.body).toEqual({ oneClickUnsubscribe: false });
    expect(oneClickBox().checked).toBe(false);
    expect(requireBox().checked).toBe(true);
    expect(save().disabled).toBe(true);
  });

  it("sends both when both changed, and can turn one back on", async () => {
    const calls = await open();
    fireEvent.click(requireBox());
    fireEvent.click(oneClickBox());
    fireEvent.click(save());
    await screen.findByText("Unsubscribe settings updated");
    expect(patches(calls)[0]!.body).toEqual({ requireUnsubscribeLink: false, oneClickUnsubscribe: false });
    fireEvent.click(requireBox());
    fireEvent.click(save());
    await waitFor(() => expect(patches(calls)).toHaveLength(2));
    expect(patches(calls)[1]!.body).toEqual({ requireUnsubscribeLink: true });
  });

  it("ticking and unticking back is not a change", async () => {
    await open();
    fireEvent.click(requireBox());
    expect(save().disabled).toBe(false);
    fireEvent.click(requireBox());
    expect(save().disabled).toBe(true);
  });

  it("shows the server's reason if saving fails, and keeps what was ticked", async () => {
    await open(complianceServer({ reply: fail(500, "INTERNAL_ERROR", "Something went wrong") }));
    fireEvent.click(requireBox());
    fireEvent.click(save());
    expect(await screen.findByText("Something went wrong")).toBeTruthy();
    expect(requireBox().checked).toBe(false);
    expect(screen.queryByText("Unsubscribe settings updated")).toBeNull();
  });

  it("says where the postal address in the footer comes from, and shows it", async () => {
    await open(complianceServer({ tenant: { postalAddress: "Acme Inc.\n1 Road" } }));
    expect(within(card()).getByText("Company Details")).toBeTruthy();
    expect(within(card()).getByText(/Acme Inc\./).textContent).toBe("Acme Inc.\n1 Road");
    expect(screen.queryByText(/not set yet/)).toBeNull();
  });

  it("says the unsubscribe footer is automatic and cannot be edited", async () => {
    await open();
    expect(within(card()).getByText(/every email automatically ends with the standard unsubscribe footer/)).toBeTruthy();
    expect(within(card()).getByText(/Nobody can edit or remove it/)).toBeTruthy();
  });

  it("warns that campaigns cannot launch while the company has no postal address", async () => {
    await open(complianceServer({ tenant: { postalAddress: "" } }));
    expect(screen.getByText(/not set yet, so campaigns cannot be launched/)).toBeTruthy();
  });

  it("shows why it cannot load, instead of empty checkboxes", async () => {
    stubApi(({ method, path }) =>
      method === "GET" && path === "/api/me" ? fail(500, "INTERNAL_ERROR", "boom")
        : method === "GET" && path === "/api/sender" ? { json: senderStatus(null) }
        : method === "GET" && path === "/api/test-recipients" ? { json: { items: [] } }
        : method === "GET" && path === "/api/suppressions" ? { json: page([]) }
        : undefined,
    );
    openEmailService();
    expect(await screen.findByText("boom")).toBeTruthy();
    expect(screen.queryByLabelText("Require an unsubscribe link in every campaign")).toBeNull();
  });
});

describe("Suppression list (Email Service tab)", () => {
  const entry = (over: Partial<SuppressionDto> = {}): SuppressionDto => ({ id: "s1", email: "gone@example.test", reason: "Unsubscribed", createdAt: "2026-11-06T14:30:00.000Z", ...over });
  const serve = (suppressions: Handler): Handler => (c) =>
    suppressions(c) ??
    (c.method === "GET" && c.path === "/api/sender" ? { json: senderStatus(null) }
      : c.method === "GET" && c.path === "/api/me" ? { json: meDto() }
      : c.method === "GET" && c.path === "/api/test-recipients" ? { json: { items: [] } }
      : undefined);
  const card = () => screen.getByText("Suppression list", { selector: "h2" }).closest(".rounded-xl") as HTMLElement;

  it("lists the addresses that unsubscribed, from the server, with why and when", async () => {
    stubApi(serve((c) => (c.path === "/api/suppressions" ? { json: page([entry(), entry({ id: "s2", email: "also@example.test" })]) } : undefined)));
    openEmailService();
    expect(await within(card()).findByText("gone@example.test")).toBeTruthy();
    expect(within(card()).getByText("also@example.test")).toBeTruthy();
    expect(within(card()).getAllByText(/Unsubscribed, /)).toHaveLength(2);
    expect(within(card()).queryByText("No suppressed addresses yet.")).toBeNull();
  });

  it("says plainly when nobody has unsubscribed", async () => {
    stubApi(serve((c) => (c.path === "/api/suppressions" ? { json: page([]) } : undefined)));
    openEmailService();
    expect(await within(card()).findByText("No suppressed addresses yet.")).toBeTruthy();
  });

  it("is read-only: there is no button to add an address", async () => {
    stubApi(serve((c) => (c.path === "/api/suppressions" ? { json: page([entry()]) } : undefined)));
    openEmailService();
    await within(card()).findByText("gone@example.test");
    expect(within(card()).queryByRole("button", { name: "Add address" })).toBeNull();
    expect(within(card()).queryByRole("textbox")).toBeNull();
  });

  it("asks for the first page, and pages through a long list", async () => {
    const calls = stubApi(serve((c) => (c.path === "/api/suppressions" ? { json: page([entry({ id: `p${c.query.get("page")}`, email: `page${c.query.get("page")}@example.test` })], 60, Number(c.query.get("page")), 25) } : undefined)));
    openEmailService();
    await within(card()).findByText("page1@example.test");
    const first = calls.find((c) => c.path === "/api/suppressions")!;
    expect(first.query.get("page")).toBe("1");
    expect(first.query.get("pageSize")).toBe("25");
    fireEvent.click(within(card()).getByRole("button", { name: "Next" }));
    expect(await within(card()).findByText("page2@example.test")).toBeTruthy();
  });

  it("says why it could not load, instead of looking empty", async () => {
    stubApi(serve((c) => (c.path === "/api/suppressions" ? { status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Could not load the list", correlationId: "ref-77" } } } : undefined)));
    openEmailService();
    expect(await within(card()).findByText("Could not load the list")).toBeTruthy();
    expect(within(card()).queryByText("No suppressed addresses yet.")).toBeNull();
  });
});
