// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { EmailTemplates } from "../../src/client/pages/EmailTemplates";
import type { EmailTemplateSummaryDto } from "../../src/shared/api";
import { renderAt, stubApi, templateDto, templateSummary, type Call, type Handler } from "./harness";
import { rte } from "./rte";

const fail = (status: number, code: string, message: string, details?: unknown) => ({ status, json: { error: { code, message, details, correlationId: "x" } } });
const T = "2026-11-01T10:00:00.000Z";
const AVAILABLE = [
  { id: "automotive-services", name: "Automotive Services", createdAt: T, updatedAt: T },
  { id: "construction", name: "Construction", createdAt: T, updatedAt: T },
  { id: "digital-marketing", name: "Digital Marketing", createdAt: T, updatedAt: T },
];
const MINE: EmailTemplateSummaryDto[] = [
  templateSummary({ id: "m1", name: "Digital Marketing", systemKey: "digital-marketing" }),
  templateSummary({ id: "m2", name: "Our own pitch", systemKey: null }),
];

/** A server that remembers what was added and removed, like the real one. */
function server(opts: { mine?: EmailTemplateSummaryDto[]; manageReply?: ReturnType<typeof fail>; availableReply?: ReturnType<typeof fail> | { json: unknown }; listReply?: ReturnType<typeof fail>; addReply?: ReturnType<typeof fail>; removeReply?: ReturnType<typeof fail>; createReply?: ReturnType<typeof fail> } = {}): Handler {
  let mine = opts.mine ?? MINE;
  let available = AVAILABLE;
  return ({ method, path, body }: Call) => {
    if (method === "POST" && path === "/api/email-templates/available") {
      if (opts.manageReply) return opts.manageReply;
      const made = { id: "sys-new", name: body.name, createdAt: T, updatedAt: T };
      available = [...available, made];
      return { status: 201, json: { ...made, htmlBody: body.htmlBody } };
    }
    const sysOne = /^\/api\/email-templates\/available\/([^/]+)$/.exec(path);
    if (sysOne && method === "PUT") {
      if (opts.manageReply) return opts.manageReply;
      available = available.map((a) => (a.id === sysOne[1] ? { ...a, name: body.name } : a));
      return { json: { ...available.find((a) => a.id === sysOne[1])!, htmlBody: body.htmlBody } };
    }
    if (sysOne && method === "DELETE") {
      if (opts.manageReply) return opts.manageReply;
      available = available.filter((a) => a.id !== sysOne[1]);
      return { status: 204, json: undefined };
    }
    if (method === "GET" && path === "/api/email-templates/available") return opts.availableReply ?? { json: { items: available } };
    const av = /^\/api\/email-templates\/available\/([^/]+)$/.exec(path);
    if (av && method === "GET") {
      const t = available.find((a) => a.id === av[1]);
      return t ? { json: { ...t, htmlBody: `<p>Hello {{firstName}} at <strong>{{companyName}}</strong> (system ${t.name})</p>` } } : fail(404, "NOT_FOUND", "Template not found");
    }
    const add = /^\/api\/email-templates\/available\/([^/]+)\/add$/.exec(path);
    if (add && method === "POST") {
      if (opts.addReply) return opts.addReply;
      const t = available.find((a) => a.id === add[1])!;
      const made = templateSummary({ id: `new-${t.id}`, name: t.name, systemKey: t.id });
      mine = [...mine, made];
      return { status: 201, json: { ...made, htmlBody: "<p>x</p>" } };
    }
    if (method === "GET" && path === "/api/email-templates") return opts.listReply ?? { json: { items: mine } };
    const one = /^\/api\/email-templates\/([^/]+)$/.exec(path);
    if (one && method === "GET") {
      const t = mine.find((i) => i.id === one[1]);
      return t ? { json: templateDto({ ...t, htmlBody: `<p>Hello {{firstName}} at <strong>{{companyName}}</strong> (mine ${t.name})</p>` }) } : fail(404, "NOT_FOUND", "Template not found");
    }
    if (one && method === "PUT") {
      mine = mine.map((i) => (i.id === one[1] ? { ...i, name: body.name } : i));
      return { json: templateDto({ ...mine.find((i) => i.id === one[1])!, htmlBody: body.htmlBody }) };
    }
    if (one && method === "DELETE") {
      if (opts.removeReply) return opts.removeReply;
      mine = mine.filter((i) => i.id !== one[1]);
      return { status: 204, json: undefined };
    }
    if (method === "POST" && path === "/api/email-templates") {
      if (opts.createReply) return opts.createReply;
      const made = templateSummary({ id: "created1", name: body.name, systemKey: null });
      mine = [...mine, made];
      return { status: 201, json: { ...made, htmlBody: body.htmlBody } };
    }
    return undefined;
  };
}
const open = (handler: Handler = server()) => {
  const calls = stubApi(handler);
  renderAt(<EmailTemplates />, { path: "/templates", route: "/templates" });
  return calls;
};
const row = (name: string) => screen.getByText(name, { selector: "td" }).closest("tr")!;
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const openMenu = (rowName: string) => fireEvent.click(within(row(rowName)).getByRole("button", { name: `Actions for ${rowName}` }));
/** The entries of a row's Actions dropdown, in order (the menu is closed again afterwards). */
const items = (rowName: string) => {
  openMenu(rowName);
  const labels = screen.getAllByRole("menuitem").map((b) => b.textContent);
  fireEvent.keyDown(document, { key: "Escape" });
  return labels;
};
/** Opens a row's Actions dropdown and picks one entry by its accessible name. */
const choose = (rowName: string, entry: string) => {
  openMenu(rowName);
  fireEvent.click(screen.getByRole("menuitem", { name: entry }));
};

describe("Email Templates page: the two tabs", () => {
  it("has Available Templates and My Templates, in that order, and starts on Available", async () => {
    open();
    expect((await screen.findAllByRole("tab")).map((t) => t.textContent)).toEqual(["Available Templates", "My Templates"]);
    expect(screen.getByRole("tab", { name: "Available Templates" }).getAttribute("aria-selected")).toBe("true");
    await screen.findByText("Construction", { selector: "td" });
    expect(screen.queryByText("Our own pitch")).toBeNull();
    tab("My Templates");
    expect(await screen.findByText("Our own pitch", { selector: "td" })).toBeTruthy();
    expect(screen.queryByText("Construction", { selector: "td" })).toBeNull();
  });
});

describe("paging", () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `t${i + 1}`, name: `Template ${String(i + 1).padStart(2, "0")}`, createdAt: T, updatedAt: T }));

  it("shows 50 Available Templates per page and moves between pages", async () => {
    open(server({ availableReply: { json: { items: many } } }));
    await screen.findByText("Template 01", { selector: "td" });
    expect(screen.getByText("1-50 of 120")).toBeTruthy();
    expect(screen.queryByText("Template 51", { selector: "td" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Template 51", { selector: "td" })).toBeTruthy();
    expect(screen.queryByText("Template 01", { selector: "td" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Last page" }));
    expect(await screen.findByText("Template 120", { selector: "td" })).toBeTruthy();
    expect(screen.getByText("101-120 of 120")).toBeTruthy();
  });

  it("shows no pager when everything fits on one page", async () => {
    open();
    await screen.findByText("Construction", { selector: "td" });
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });
});

describe("Available Templates tab", () => {
  it("lists the system templates, marked System, with View and Add to My Templates", async () => {
    open();
    await screen.findByText("Construction", { selector: "td" });
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Template", "Type", "Actions"]);
    for (const name of ["Automotive Services", "Construction"]) {
      expect(within(row(name)).getByText("System")).toBeTruthy();
      expect(items(name)).toEqual(["View", "Add to My Templates"]);
    }
  });

  it("shows which are already in My Templates, with no Add button for them", async () => {
    open();
    await screen.findByText("Construction", { selector: "td" });
    await waitFor(() => expect(within(row("Digital Marketing")).queryByText("In My Templates")).not.toBeNull());
    expect(items("Digital Marketing")).toEqual(["View"]);
    expect(within(row("Construction")).queryByText("In My Templates")).toBeNull();
  });

  it("lets you add one: it is copied on the server, marked, and the Add button goes away", async () => {
    const calls = open();
    await screen.findByText("Construction", { selector: "td" });
    choose("Construction", "Add Construction to My Templates");
    expect(await screen.findByText('"Construction" added to My Templates')).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]).toMatchObject({ method: "POST", path: "/api/email-templates/available/construction/add" });
    await waitFor(() => expect(within(row("Construction")).queryByText("In My Templates")).not.toBeNull());
    expect(items("Construction")).toEqual(["View"]);
    expect(items("Automotive Services")).toContain("Add to My Templates"); // the others are untouched
  });

  it("shows why adding failed", async () => {
    open(server({ addReply: fail(409, "TOO_MANY_TEMPLATES", "You can have at most 100 templates") }));
    await screen.findByText("Construction", { selector: "td" });
    choose("Construction", "Add Construction to My Templates");
    expect(await screen.findByText("You can have at most 100 templates")).toBeTruthy();
    expect(items("Construction")).toContain("Add to My Templates");
  });

  it("has no way to create, edit or delete a system template", async () => {
    open();
    await screen.findByText("Construction", { selector: "td" });
    expect(screen.queryByRole("button", { name: /Create template|Remove|Edit|Delete/ })).toBeNull();
  });

  it("says why it could not load, instead of looking empty", async () => {
    open(server({ availableReply: fail(500, "INTERNAL_ERROR", "Could not load templates") }));
    expect(await screen.findByText("Could not load templates")).toBeTruthy();
    expect(screen.queryByText("No templates are available yet.")).toBeNull();
  });

  it("says plainly when there are none", async () => {
    open(server({ availableReply: { json: { items: [] } } as never }));
    expect(await screen.findByText("No templates are available yet.")).toBeTruthy();
  });
});

describe("My Templates tab", () => {
  const openMine = async (handler: Handler = server()) => {
    const calls = open(handler);
    await screen.findByRole("tab", { name: "My Templates" });
    tab("My Templates");
    await screen.findByText(/These are the templates offered when writing a campaign/);
    return calls;
  };

  it("lists the account's templates, saying where each came from, with View and Remove", async () => {
    await openMine();
    await screen.findByText("Our own pitch", { selector: "td" });
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Template", "Source", "Added", "Actions"]);
    expect(within(row("Digital Marketing")).getByText("From Available")).toBeTruthy();
    expect(within(row("Our own pitch")).getByText("Created by you")).toBeTruthy();
    expect(items("Our own pitch")).toEqual(["View", "Edit", "Remove"]);
  });

  it("removes one after asking, and it leaves the list", async () => {
    const calls = await openMine();
    await screen.findByText("Our own pitch", { selector: "td" });
    choose("Our own pitch", "Remove Our own pitch from My Templates");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/will no longer be offered when writing a campaign/)).toBeTruthy();
    expect(within(dialog).getByText(/cannot be brought back/)).toBeTruthy(); // it was written by the user
    expect(writes(calls)).toHaveLength(0); // nothing until confirmed
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText('"Our own pitch" removed from My Templates')).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]).toMatchObject({ method: "DELETE", path: "/api/email-templates/m2" });
    await waitFor(() => expect(screen.queryByText("Our own pitch", { selector: "td" })).toBeNull());
  });

  it("lets you edit one, and says a copy of an Available Template is changed on its own", async () => {
    const calls = await openMine();
    await screen.findByText("Digital Marketing", { selector: "td" });
    choose("Digital Marketing", "Edit Digital Marketing");
    await waitFor(() => expect((screen.getByLabelText("Template name") as HTMLInputElement).value).toBe("Digital Marketing"));
    expect(screen.getByText(/changes only your copy. The version in Available Templates stays as it is/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Our Marketing" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText('Template "Our Marketing" saved')).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]).toMatchObject({ method: "PUT", path: "/api/email-templates/m1", body: { name: "Our Marketing" } });
    expect(await screen.findByText("Our Marketing", { selector: "td" })).toBeTruthy();
  });

  it("does not remove anything when the question is answered with Keep it", async () => {
    const calls = await openMine();
    await screen.findByText("Our own pitch", { selector: "td" });
    choose("Digital Marketing", "Remove Digital Marketing from My Templates");
    expect(within(await screen.findByRole("dialog")).queryByText(/cannot be brought back/)).toBeNull(); // it can be added again from Available
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes(calls)).toHaveLength(0);
    expect(screen.getByText("Digital Marketing", { selector: "td" })).toBeTruthy();
  });

  it("shows why a removal failed", async () => {
    await openMine(server({ removeReply: fail(500, "INTERNAL_ERROR", "Something went wrong on our side") }));
    await screen.findByText("Our own pitch", { selector: "td" });
    choose("Our own pitch", "Remove Our own pitch from My Templates");
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Something went wrong on our side")).toBeTruthy();
    expect(screen.getByText("Our own pitch", { selector: "td" })).toBeTruthy();
  });

  it("says plainly when it is empty, and what to do about it", async () => {
    await openMine(server({ mine: [] }));
    expect(await screen.findByText(/My Templates is empty, so campaigns offer no templates\. Add one from Available Templates, or create your own\./)).toBeTruthy();
  });

  it("says why it could not load, instead of looking empty", async () => {
    await openMine(server({ listReply: fail(500, "INTERNAL_ERROR", "Could not load templates") }));
    expect(await screen.findByText("Could not load templates")).toBeTruthy();
  });
});

describe("Previewing a template", () => {
  it("shows an available template filled in with a sample contact, in a sandboxed frame", async () => {
    open();
    await screen.findByText("Construction", { selector: "td" });
    choose("Construction", "View Construction");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Construction", { selector: "h2" })).toBeTruthy();
    const frame = (await within(dialog).findByTitle("Template preview")) as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    const doc = frame.getAttribute("srcdoc")!;
    expect(doc).toContain("Hello Alex at <strong>Example Co</strong> (system Construction)");
    expect(doc).not.toContain("{{");
    expect(doc).not.toContain("<hr/>"); // only the message: no footer
    expect(within(dialog).getByText(/The signature, the unsubscribe footer and your postal address are added when a campaign is sent/)).toBeTruthy();
  });

  it("shows one of My Templates the same way", async () => {
    open();
    await screen.findByRole("tab", { name: "My Templates" });
    tab("My Templates");
    await screen.findByText("Our own pitch", { selector: "td" });
    choose("Our own pitch", "View Our own pitch");
    expect(((await screen.findByTitle("Template preview")) as HTMLIFrameElement).getAttribute("srcdoc")).toContain("(mine Our own pitch)");
  });

  it("closes, and opens another", async () => {
    open();
    await screen.findByText("Construction", { selector: "td" });
    choose("Construction", "View Construction");
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    choose("Automotive Services", "View Automotive Services");
    expect(((await screen.findByTitle("Template preview")) as HTMLIFrameElement).getAttribute("srcdoc")).toContain("(system Automotive Services)");
  });
});

describe("Creating a template", () => {
  const openCreate = async (handler: Handler = server()) => {
    const calls = open(handler);
    await screen.findByRole("tab", { name: "My Templates" });
    tab("My Templates");
    fireEvent.click(await screen.findByRole("button", { name: "Create template" }));
    await screen.findByRole("dialog");
    return calls;
  };
  const nameBox = () => screen.getByLabelText("Template name") as HTMLInputElement;
  const message = () => rte("Message");
  const submitIn = () => within(screen.getByRole("dialog")).getByRole("button", { name: "Create template" }) as HTMLButtonElement;

  it("opens a form with a name and a rich-text message with merge-field buttons, and nothing is saved until it is sent", async () => {
    const calls = await openCreate();
    expect(nameBox().value).toBe("");
    expect(message().toolbar()).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "{{firstName}}" })).toHaveLength(1);
    expect(writes(calls)).toHaveLength(0);
  });

  it("cannot be sent until there is a name and a message", async () => {
    await openCreate();
    expect(submitIn().disabled).toBe(true);
    fireEvent.change(nameBox(), { target: { value: "My template" } });
    expect(submitIn().disabled).toBe(true);
    message().set("<p>&nbsp;</p>");
    expect(submitIn().disabled).toBe(true);
    message().set("<p>Hello {{firstName}}</p>");
    expect(submitIn().disabled).toBe(false);
    fireEvent.change(nameBox(), { target: { value: "   " } });
    expect(submitIn().disabled).toBe(true);
  });

  it("creates it: sends the trimmed name and the message as written, lists it as the organization's own, and closes", async () => {
    const calls = await openCreate();
    fireEvent.change(nameBox(), { target: { value: "  Fresh pitch " } });
    message().set("<p>Hello {{firstName}}, <strong>welcome</strong></p>");
    fireEvent.click(submitIn());
    expect(await screen.findByText('Template "Fresh pitch" created')).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]).toMatchObject({ method: "POST", path: "/api/email-templates", body: { name: "Fresh pitch", htmlBody: "<p>Hello {{firstName}}, <strong>welcome</strong></p>" } });
    expect(Object.keys(writes(calls)[0]!.body).sort()).toEqual(["htmlBody", "name"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(row("Fresh pitch")).getByText("Created by you")).toBeTruthy();
  });

  it("warns about a merge field that does not exist before it is sent", async () => {
    await openCreate();
    fireEvent.change(nameBox(), { target: { value: "Typo" } });
    message().set("<p>Hi {{frstName}}</p>");
    expect(await screen.findByText("Unknown merge field: {{frstName}}")).toBeTruthy();
  });

  it("shows the server's reason under the name when it is taken, and keeps what was typed", async () => {
    await openCreate(server({ createReply: fail(409, "TEMPLATE_NAME_TAKEN", "A template with that name already exists", [{ path: "name", message: "A template with that name already exists" }]) }));
    fireEvent.change(nameBox(), { target: { value: "Our own pitch" } });
    message().set("<p>Hi</p>");
    fireEvent.click(submitIn());
    expect(await screen.findByText("A template with that name already exists")).toBeTruthy();
    expect(nameBox().value).toBe("Our own pitch");
    expect(message().value()).toBe("<p>Hi</p>");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("explains any other failure", async () => {
    await openCreate(server({ createReply: fail(409, "TOO_MANY_TEMPLATES", "You can have at most 100 templates") }));
    fireEvent.change(nameBox(), { target: { value: "One too many" } });
    message().set("<p>Hi</p>");
    fireEvent.click(submitIn());
    expect(await screen.findByText("You can have at most 100 templates")).toBeTruthy();
  });

  it("starts empty again the next time it is opened, and Cancel creates nothing", async () => {
    const calls = await openCreate();
    fireEvent.change(nameBox(), { target: { value: "Half done" } });
    message().set("<p>Half</p>");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    await screen.findByRole("dialog");
    expect(nameBox().value).toBe("");
    expect(writes(calls)).toHaveLength(0);
  });
});
