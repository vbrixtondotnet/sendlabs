// @vitest-environment jsdom
import { EMAIL_FOOTER_ENABLED, LIST_UNSUBSCRIBE_HEADERS_ENABLED } from "../../src/shared/merge";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MySettings as Settings } from "../../src/client/pages/MySettings";
import type { MeDto, SuppressionDto } from "../../src/shared/api";
import { meDto, page, renderAt, senderDto, senderStatus, stubApi, testRecipientDto, type Call, type Handler } from "./harness";

const usersApi = (): Handler => ({ method, path }) =>
  method === "GET" && path === "/api/sender" ? { json: senderStatus(null) }
  : method === "GET" && path === "/api/test-recipients" ? { json: { items: [] } }
  : method === "GET" && path === "/api/me" ? { json: meDto() }
  : method === "GET" && path === "/api/suppressions" ? { json: page([]) }
  : undefined;

/** Opens Account Settings (as an Agency) and goes to the Email Service tab, where the Gmail sender, test-send list and unsubscribe rules are. */
const openEmailService = async () => {
  renderAt(<Settings />);
  fireEvent.click(await screen.findByRole("tab", { name: "Email Service" })); // the tabs appear once who is signed in has loaded
};

describe("Settings tabs", () => {
  it("an Agency has Profile, Account Details, Company Details and Email Service, opening on Profile", async () => {
    stubApi(usersApi());
    renderAt(<Settings />);
    await screen.findByRole("tab", { name: "Email Service" });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Profile", "Account Details", "Company Details", "Email Service"]);
    expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true"); // opens on the first
  });

  it("no longer has the Compliance, Sender, Sending limits or Data retention tabs", async () => {
    stubApi(usersApi());
    renderAt(<Settings />);
    await screen.findByRole("tab", { name: "Email Service" });
    for (const name of ["Compliance", "Sender", "Sending limits", "Data retention"]) expect(screen.queryByRole("tab", { name }), name).toBeNull();
  });

  it("opens on Email Service when Google sends the browser back from Connect Gmail", async () => {
    stubApi(usersApi());
    renderAt(<Settings />, { path: "/settings?sender=connected", route: "/settings" });
    expect((await screen.findByRole("tab", { name: "Email Service" })).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("Gmail sender")).toBeTruthy();
  });

  it("puts everything about sending email on Email Service: sender, test-send list, unsubscribe rules, limits, suppression list and retention", async () => {
    stubApi(usersApi());
    await openEmailService();
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
      await openEmailService();
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
      await openEmailService();
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
      await openEmailService();
      await screen.findByText("Unsubscribe and compliance");
      const note = screen.getByText(/stores a secure, encrypted key/).closest("div.lg\\:col-span-2");
      expect(note).toBeTruthy();
    });
  });

  it("starts the sender, allowlist and suppression list empty, with no mock records", async () => {
    stubApi(usersApi());
    await openEmailService();
    expect(await screen.findByText("Not connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeTruthy();
    expect(await screen.findByText(/No test addresses yet/)).toBeTruthy();
    expect(screen.getByText("No suppressed addresses yet.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/itimpact|Brian|Dana|Marcus|Priya|iam\.gserviceaccount|karen\.hughes|123 Example Street/);
  });

  it("has no separate sender postal address any more: the company's postal address is used", async () => {
    stubApi(usersApi());
    await openEmailService();
    await screen.findByText("Unsubscribe and compliance");
    expect(screen.queryByLabelText("Sender postal address")).toBeNull();
    expect(screen.queryByText("Required before launch")).toBeNull();
  });

  it("says plainly that limits and retention are not saved yet, instead of pretending to save", async () => {
    stubApi(usersApi());
    await openEmailService();
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    expect(screen.getByText("Not connected yet: nothing was saved")).toBeTruthy();
  });

  it("stays on the page", async () => {
    stubApi(usersApi());
    renderAt(<Settings />, { path: "/settings", route: "/settings" });
    await screen.findByRole("tab", { name: "Email Service" });
    expect(screen.queryByTestId("elsewhere")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });
});

describe("Company Details tab", () => {
  const company = (over: Partial<MeDto["company"]> = {}): MeDto["company"] => ({ name: "Acme", postalAddress: "", website: "", requireUnsubscribeLink: true, oneClickUnsubscribe: true, ...over });
  const fail = (status: number, code: string, message: string, details?: unknown) => ({ status, json: { error: { code, message, details, correlationId: "x" } } });

  /** A server that remembers what was saved, like the real one. */
  function companyServer(opts: { company?: Partial<MeDto["company"]>; reply?: ReturnType<typeof fail> } = {}): Handler {
    let me: MeDto = { user: { id: "u1", role: "Agency", avatarUrl: null, email: "a@acme.test", firstName: "A", lastName: "B", position: "", displayName: "A B", mustChangePassword: false, credits: 100 }, company: company(opts.company), session: true };
    return ({ method, path, body }) => {
      if (method === "GET" && path === "/api/me") return { json: me };
      if (method === "GET" && path === "/api/sender") return { json: senderStatus(null) };
      if (method === "GET" && path === "/api/test-recipients") return { json: { items: [] } };
      if (method === "PATCH" && path === "/api/me/company") {
        if (opts.reply) return opts.reply;
        const postal = typeof body.postalAddress === "string" ? body.postalAddress.split("\n").map((l: string) => l.trim()).filter(Boolean).join("\n") : me.company.postalAddress;
        me = { ...me, company: { ...me.company, name: body.name ?? me.company.name, website: body.website ?? me.company.website, postalAddress: postal } };
        return { json: me.company };
      }
      return undefined;
    };
  }
  const openCompany = async (handler: Handler = companyServer()) => {
    const calls = stubApi(handler);
    renderAt(<Settings />);
    fireEvent.click(await screen.findByRole("tab", { name: "Company Details" }));
    await screen.findByLabelText("Postal address");
    return calls;
  };
  const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  const area = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const save = () => screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
  const patches = (calls: Call[]) => calls.filter((c) => c.method === "PATCH");

  it("shows Name, Website and Postal address, filled in with what is saved", async () => {
    await openCompany(companyServer({ company: { name: "Acme", website: "acme.test", postalAddress: "Acme Inc.\n1 Road" } }));
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
    expect(patches(calls)[0]!.path).toBe("/api/me/company");
    expect(patches(calls)[0]!.body).toEqual({ website: "sabertoothsoftwarelabs.net" });
    expect(input("Website").value).toBe("sabertoothsoftwarelabs.net");
    expect(save().disabled).toBe(true);
  });

  it("can clear the website again", async () => {
    const calls = await openCompany(companyServer({ company: { website: "old.test" } }));
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
    const calls = await openCompany(companyServer({ company: { postalAddress: "Old address" } }));
    type("Postal address", "");
    fireEvent.click(save());
    await screen.findByText("Company details updated");
    expect(patches(calls)[0]!.body).toEqual({ postalAddress: "" });
  });

  it("retyping the same address with different spacing is not a change", async () => {
    await openCompany(companyServer({ company: { postalAddress: "Acme Inc.\n1 Road" } }));
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

describe("Sender name (Email Service tab)", () => {
  /** A server that remembers the saved name, like the real one. */
  const server = (start = ""): Handler => {
    let name = start;
    return ({ method, path, body }) => {
      if (method === "GET" && path === "/api/sender") return { json: senderStatus(senderDto({ senderName: name })) };
      if (method === "PATCH" && path === "/api/sender") { name = body.senderName; return { json: senderStatus(senderDto({ senderName: name })) }; }
      if (method === "GET" && path === "/api/me") return { json: meDto() };
      if (method === "GET" && path === "/api/test-recipients") return { json: { items: [] } };
      if (method === "GET" && path === "/api/suppressions") return { json: page([]) };
      return undefined;
    };
  };
  const box = () => screen.findByLabelText("Sender name") as Promise<HTMLInputElement>;
  const saveBtn = () => within(screen.getByLabelText("Sender name").closest("form")!).getByRole("button", { name: "Save" }) as HTMLButtonElement;

  it("shows the saved name, explains why it should match the mailbox, and has nothing to save until it is changed", async () => {
    stubApi(server("Marketing Admin"));
    await openEmailService();
    expect((await box()).value).toBe("Marketing Admin");
    expect(screen.getByText(/same name this mailbox uses in Gmail/)).toBeTruthy();
    expect(saveBtn().disabled).toBe(true);
  });

  it("saves a new name, sending it trimmed, and then has nothing left to save", async () => {
    const calls = stubApi(server());
    await openEmailService();
    const input = await box();
    fireEvent.change(input, { target: { value: "  Marketing Admin " } });
    expect(saveBtn().disabled).toBe(false);
    fireEvent.click(saveBtn());
    expect(await screen.findByText("Sender name saved")).toBeTruthy();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ path: "/api/sender", body: { senderName: "Marketing Admin" } });
    await waitFor(() => expect(saveBtn().disabled).toBe(true));
    expect(((await box()) as HTMLInputElement).value).toBe("Marketing Admin");
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
    await openEmailService();
    expect(await screen.findByText("qa@acme.test")).toBeTruthy();
    expect(screen.getByText("pm@acme.test")).toBeTruthy();
    expect(screen.queryByText(/No test addresses yet/)).toBeNull();
  });

  it("adds an address for real: it is sent to the server, listed afterwards, and the box is cleared", async () => {
    const calls = stubApi(allowlistServer([]));
    await openEmailService();
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
    await openEmailService();
    await screen.findByText(/No test addresses yet/);
    fireEvent.change(address(), { target: { value: "enter@acme.test" } });
    fireEvent.submit(address().closest("form")!);
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
  });

  it("does nothing for a blank box", async () => {
    const calls = stubApi(allowlistServer([]));
    await openEmailService();
    await screen.findByText(/No test addresses yet/);
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(address(), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows the server's reason (bad address, duplicate) and keeps what was typed", async () => {
    stubApi(allowlistServer([], { status: 409, json: { error: { code: "TEST_RECIPIENT_EXISTS", message: "That address is already on the list", details: [{ path: "email", message: "That address is already on the list" }], correlationId: "x" } } }));
    await openEmailService();
    await screen.findByText(/No test addresses yet/);
    fireEvent.change(address(), { target: { value: "dup@acme.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That address is already on the list");
    expect(address().value).toBe("dup@acme.test");
  });

  it("removes an address on the server", async () => {
    const calls = stubApi(allowlistServer([testRecipientDto(), testRecipientDto({ id: "t2", email: "pm@acme.test" })]));
    await openEmailService();
    await screen.findByText("qa@acme.test");
    fireEvent.click(screen.getByRole("button", { name: "Remove qa@acme.test" }));
    await waitFor(() => expect(screen.queryByText("qa@acme.test")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/test-recipients/t1")).toBe(true);
    expect(screen.getByText("pm@acme.test")).toBeTruthy();
  });

  it("says why it could not load, instead of looking empty", async () => {
    stubApi(({ method, path }) =>
      path === "/api/me" ? { json: meDto() }
        : method === "GET" && path === "/api/sender" ? { json: senderStatus(null) }
        : path === "/api/test-recipients" ? { status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Something went wrong", correlationId: "ref-9" } } }
        : undefined,
    );
    await openEmailService();
    expect(await screen.findByText("Reference: ref-9")).toBeTruthy();
    expect(screen.queryByText(/No test addresses yet/)).toBeNull();
  });
});

describe("Unsubscribe and compliance (Email Service tab)", () => {
  const fail = (status: number, code: string, message: string) => ({ status, json: { error: { code, message, correlationId: "x" } } });

  /** A server that remembers what was saved, like the real one. */
  function complianceServer(opts: { company?: Partial<MeDto["company"]>; reply?: ReturnType<typeof fail> } = {}): Handler {
    let me = meDto({}, opts.company);
    return ({ method, path, body }) => {
      if (method === "GET" && path === "/api/me") return { json: me };
      if (method === "GET" && path === "/api/sender") return { json: senderStatus(null) };
      if (method === "GET" && path === "/api/test-recipients") return { json: { items: [] } };
      if (method === "GET" && path === "/api/suppressions") return { json: page([]) };
      if (method === "PATCH" && path === "/api/me/company") {
        if (opts.reply) return opts.reply;
        me = { ...me, company: { ...me.company, ...body } };
        return { json: me.company };
      }
      return undefined;
    };
  }
  const open = async (handler: Handler = complianceServer()) => {
    const calls = stubApi(handler);
    await openEmailService();
    await screen.findByText("Unsubscribe and compliance");
    await screen.findByLabelText(/Unsubscribe link in every campaign/);
    return calls;
  };
  const requireBox = () => screen.getByLabelText(/Unsubscribe link in every campaign/) as HTMLInputElement;
  const oneClickBox = () => screen.getByLabelText(/One-click unsubscribe \(List-Unsubscribe headers\)/) as HTMLInputElement;
  /** The card itself: the Data retention card has a Save button too. */
  const card = () => screen.getByText("Unsubscribe and compliance").closest(".rounded-xl") as HTMLElement;

  it.runIf(EMAIL_FOOTER_ENABLED && LIST_UNSUBSCRIBE_HEADERS_ENABLED)("shows both protections as ticked, locked and always on, with no way to turn them off or save", async () => {
    const calls = await open();
    for (const box of [requireBox(), oneClickBox()]) {
      expect(box.checked).toBe(true);
      expect(box.disabled).toBe(true);
    }
    expect(within(card()).getAllByText("Always on")).toHaveLength(2);
    expect(within(card()).queryByRole("button", { name: "Save" })).toBeNull();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it.runIf(!EMAIL_FOOTER_ENABLED && LIST_UNSUBSCRIBE_HEADERS_ENABLED)("shows the footer as off for now and the one-click headers as always on, with nothing to save and no postal address note", async () => {
    const calls = await open();
    expect(requireBox().checked).toBe(false);
    expect(requireBox().disabled).toBe(true);
    expect(oneClickBox().checked).toBe(true);
    expect(within(card()).getByText("Off for now")).toBeTruthy();
    expect(within(card()).getAllByText("Always on")).toHaveLength(1);
    expect(within(card()).getByText(/switched off for now/)).toBeTruthy();
    expect(within(card()).queryByText(/Company Details/)).toBeNull(); // the note about where the footer address comes from is gone
    expect(within(card()).queryByRole("button", { name: "Save" })).toBeNull();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it.runIf(EMAIL_FOOTER_ENABLED && LIST_UNSUBSCRIBE_HEADERS_ENABLED)("shows them as always on even when the stored setting says off", async () => {
    await open(complianceServer({ company: { requireUnsubscribeLink: false, oneClickUnsubscribe: false } }));
    expect(requireBox().checked).toBe(true);
    expect(oneClickBox().checked).toBe(true);
  });

  it.runIf(EMAIL_FOOTER_ENABLED && !LIST_UNSUBSCRIBE_HEADERS_ENABLED)("shows the footer link as always on and the one-click headers as off for now, with nothing to save", async () => {
    const calls = await open();
    expect(requireBox().checked).toBe(true);
    expect(oneClickBox().checked).toBe(false);
    expect(oneClickBox().disabled).toBe(true);
    expect(within(card()).getByText("Always on")).toBeTruthy();
    expect(within(card()).getByText("Off for now")).toBeTruthy();
    expect(within(card()).getByText(/sent without these headers, like a one-to-one email/)).toBeTruthy();
    expect(within(card()).queryByRole("button", { name: "Save" })).toBeNull();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it.runIf(LIST_UNSUBSCRIBE_HEADERS_ENABLED)("explains that Gmail and Yahoo require one-click unsubscribe, and that it suppresses straight away", async () => {
    await open();
    expect(within(card()).getByText(/Gmail and Yahoo require one-click unsubscribe/)).toBeTruthy();
    expect(within(card()).getByText(/added to your suppression list straight away/)).toBeTruthy();
  });

  it.runIf(EMAIL_FOOTER_ENABLED)("says where the postal address in the footer comes from, and shows it", async () => {
    await open(complianceServer({ company: { postalAddress: "Acme Inc.\n1 Road" } }));
    expect(within(card()).getByText("Company Details")).toBeTruthy();
    expect(within(card()).getByText(/Acme Inc\./).textContent).toBe("Acme Inc.\n1 Road");
    expect(screen.queryByText(/not set yet/)).toBeNull();
  });

  it.runIf(EMAIL_FOOTER_ENABLED)("says the unsubscribe footer is automatic and cannot be edited", async () => {
    await open();
    expect(within(card()).getByText(/Every email automatically ends with the standard unsubscribe footer/)).toBeTruthy();
    expect(within(card()).getByText(/Nobody can edit or remove it/)).toBeTruthy();
  });

  it.runIf(EMAIL_FOOTER_ENABLED)("warns that campaigns cannot launch while the company has no postal address", async () => {
    await open(complianceServer({ company: { postalAddress: "" } }));
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
    renderAt(<Settings />); // who is signed in cannot be loaded, so the page says why instead of showing any tab
    expect(await screen.findByText("boom")).toBeTruthy();
    expect(screen.queryByLabelText(/Unsubscribe link in every campaign/)).toBeNull();
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
    await openEmailService();
    expect(await within(card()).findByText("gone@example.test")).toBeTruthy();
    expect(within(card()).getByText("also@example.test")).toBeTruthy();
    expect(within(card()).getAllByText(/Unsubscribed, /)).toHaveLength(2);
    expect(within(card()).queryByText("No suppressed addresses yet.")).toBeNull();
  });

  it("says plainly when nobody has unsubscribed", async () => {
    stubApi(serve((c) => (c.path === "/api/suppressions" ? { json: page([]) } : undefined)));
    await openEmailService();
    expect(await within(card()).findByText("No suppressed addresses yet.")).toBeTruthy();
  });

  it("is read-only: there is no button to add an address", async () => {
    stubApi(serve((c) => (c.path === "/api/suppressions" ? { json: page([entry()]) } : undefined)));
    await openEmailService();
    await within(card()).findByText("gone@example.test");
    expect(within(card()).queryByRole("button", { name: "Add address" })).toBeNull();
    expect(within(card()).queryByRole("textbox")).toBeNull();
  });

  it("asks for the first page, and pages through a long list", async () => {
    const calls = stubApi(serve((c) => (c.path === "/api/suppressions" ? { json: page([entry({ id: `p${c.query.get("page")}`, email: `page${c.query.get("page")}@example.test` })], 60, Number(c.query.get("page")), 25) } : undefined)));
    await openEmailService();
    await within(card()).findByText("page1@example.test");
    const first = calls.find((c) => c.path === "/api/suppressions")!;
    expect(first.query.get("page")).toBe("1");
    expect(first.query.get("pageSize")).toBe("25");
    fireEvent.click(within(card()).getByRole("button", { name: "Next" }));
    expect(await within(card()).findByText("page2@example.test")).toBeTruthy();
  });

  it("says why it could not load, instead of looking empty", async () => {
    stubApi(serve((c) => (c.path === "/api/suppressions" ? { status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Could not load the list", correlationId: "ref-77" } } } : undefined)));
    await openEmailService();
    expect(await within(card()).findByText("Could not load the list")).toBeTruthy();
    expect(within(card()).queryByText("No suppressed addresses yet.")).toBeNull();
  });
});
