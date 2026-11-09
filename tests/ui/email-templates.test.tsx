// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { EmailTemplates } from "../../src/client/pages/EmailTemplates";
import type { EmailTemplateSummaryDto } from "../../src/shared/api";
import type { Role } from "../../src/shared/types";
import { renderAt, stubApi, templateDto, templateSummary, type Call, type Handler } from "./harness";
import { rte } from "./rte";

const fail = (status: number, code: string, message: string, details?: unknown) => ({ status, json: { error: { code, message, details, correlationId: "x" } } });
const BUILTINS = ["Automotive Services", "Construction", "Digital Marketing"].map((name, i) => templateSummary({ id: `b${i}`, name, builtin: true }));

/** A server that remembers what was picked and added, like the real one. */
function server(opts: { items?: EmailTemplateSummaryDto[]; listReply?: ReturnType<typeof fail>; selectReply?: ReturnType<typeof fail>; createReply?: ReturnType<typeof fail> } = {}): Handler {
  let items = opts.items ?? BUILTINS;
  return ({ method, path, body }: Call) => {
    if (method === "GET" && path === "/api/email-templates") return opts.listReply ?? { json: { items } };
    const one = /^\/api\/email-templates\/([^/]+)$/.exec(path);
    if (one && method === "GET") {
      const t = items.find((i) => i.id === one[1]);
      return t ? { json: templateDto({ ...t, htmlBody: `<p>Hello {{firstName}} at <strong>{{companyName}}</strong> (${t.name})</p>` }) } : fail(404, "NOT_FOUND", "Template not found");
    }
    const sel = /^\/api\/email-templates\/([^/]+)\/selected$/.exec(path);
    if (sel && method === "PUT") {
      if (opts.selectReply) return opts.selectReply;
      items = items.map((i) => (i.id === sel[1] ? { ...i, selected: body.selected } : i));
      return { json: items.find((i) => i.id === sel[1]) };
    }
    if (method === "POST" && path === "/api/email-templates") {
      if (opts.createReply) return opts.createReply;
      const made = templateSummary({ id: "new1", name: body.name, builtin: false, selected: false });
      items = [...items, made];
      return { status: 201, json: { ...made, htmlBody: body.htmlBody } };
    }
    return undefined;
  };
}
const open = (handler: Handler = server(), role: Role = "Administrator") => {
  const calls = stubApi(handler);
  renderAt(<EmailTemplates />, { path: "/templates", route: "/templates", role });
  return calls;
};
const row = (name: string) => screen.getByText(name, { selector: "td" }).closest("tr")!;
const addBtn = (name: string) => screen.getByRole("button", { name: `Add ${name} to My Templates` }) as HTMLButtonElement;
const removeBtn = (name: string) => screen.getByRole("button", { name: `Remove ${name} from My Templates` }) as HTMLButtonElement;
const inMine = (name: string) => within(row(name)).queryByText("In My Templates") !== null;
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

describe("Email Templates page", () => {
  it("lists the templates, saying which come with the app, and when each was added", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Email Templates" })).toBeTruthy();
    await screen.findByText("Automotive Services", { selector: "td" });
    for (const t of BUILTINS) {
      expect(within(row(t.name)).getByText("Built in")).toBeTruthy();
      expect(within(row(t.name)).getByText(/Nov/)).toBeTruthy();
    }
  });

  it("explains what it is for", async () => {
    open();
    expect(await screen.findByText(/Add the ones you want to My Templates/)).toBeTruthy();
  });

  it("has no Use in campaigns column and no tick boxes: the choice is a button", async () => {
    open();
    await screen.findByText("Construction", { selector: "td" });
    expect(screen.queryByRole("columnheader", { name: /Use in campaigns/i })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/Not offered|^Offered$/)).toBeNull();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Template", "Type", "Added", "Actions"]);
  });

  it("puts Add to My Templates after Preview, in the Actions column, on every row", async () => {
    open();
    await screen.findByText("Construction", { selector: "td" });
    for (const t of BUILTINS) {
      const buttons = within(row(t.name)).getAllByRole("button").map((b) => b.textContent);
      expect(buttons, t.name).toEqual(["Preview", "Add to My Templates"]);
    }
  });

  it("shows how many are in My Templates, and says when none are", async () => {
    open(server({ items: [{ ...BUILTINS[0]!, selected: true }, BUILTINS[1]!, BUILTINS[2]!] }));
    expect(await screen.findByText("1 of 3 in My Templates, offered when writing a campaign.")).toBeTruthy();
    expect(inMine("Automotive Services")).toBe(true);
    expect(inMine("Construction")).toBe(false);
  });

  it("starts with My Templates empty: nothing is offered in campaigns until something is added", async () => {
    open();
    expect(await screen.findByText("My Templates is empty, so campaigns offer no templates.")).toBeTruthy();
    for (const t of BUILTINS) {
      expect(inMine(t.name)).toBe(false);
      expect(addBtn(t.name)).toBeTruthy();
    }
  });

  it("adds a template to My Templates: it is saved on the server, marked, counted, and the button turns into Remove", async () => {
    const calls = open();
    await screen.findByText("Construction", { selector: "td" });
    fireEvent.click(addBtn("Construction"));
    await waitFor(() => expect(inMine("Construction")).toBe(true));
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]).toMatchObject({ method: "PUT", path: "/api/email-templates/b1/selected", body: { selected: true } });
    expect(removeBtn("Construction").textContent).toBe("Remove from My Templates");
    expect(screen.queryByRole("button", { name: "Add Construction to My Templates" })).toBeNull();
    expect(await screen.findByText("1 of 3 in My Templates, offered when writing a campaign.")).toBeTruthy();
    expect(addBtn("Digital Marketing")).toBeTruthy(); // the others are untouched
  });

  it("removes one from My Templates, and the button goes back to Add", async () => {
    const calls = open(server({ items: BUILTINS.map((t) => ({ ...t, selected: true })) }));
    await screen.findByText("3 of 3 in My Templates, offered when writing a campaign.");
    fireEvent.click(removeBtn("Digital Marketing"));
    await waitFor(() => expect(inMine("Digital Marketing")).toBe(false));
    expect(writes(calls)[0]).toMatchObject({ path: "/api/email-templates/b2/selected", body: { selected: false } });
    expect(addBtn("Digital Marketing").textContent).toBe("Add to My Templates");
    expect(await screen.findByText("2 of 3 in My Templates, offered when writing a campaign.")).toBeTruthy();
  });

  it("shows why it failed, and leaves the template as it was", async () => {
    open(server({ selectReply: fail(500, "INTERNAL_ERROR", "Something went wrong on our side") }));
    await screen.findByText("Construction", { selector: "td" });
    fireEvent.click(addBtn("Construction"));
    expect(await screen.findByText("Something went wrong on our side")).toBeTruthy();
    await waitFor(() => expect(inMine("Construction")).toBe(false));
    expect(addBtn("Construction")).toBeTruthy();
  });

  it("is open to Campaign Managers: they can add to My Templates, but there is no Add template button", async () => {
    const calls = open(server(), "Campaign Manager");
    await screen.findByText("Construction", { selector: "td" });
    expect(addBtn("Construction").disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Add template" })).toBeNull();
    fireEvent.click(addBtn("Construction"));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
  });

  it("is read-only for a Viewer: they can look and preview, but have no Add to My Templates button and cannot add templates, and are told why", async () => {
    const calls = open(server(), "Viewer");
    await screen.findByText("Construction", { selector: "td" });
    expect(screen.queryByRole("button", { name: /My Templates/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add template" })).toBeNull();
    expect(screen.getByText(/Your role is read-only/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview Construction" })).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
  });

  it("does not show the read-only notice to people who can add", async () => {
    open();
    await screen.findByText("Construction", { selector: "td" });
    expect(screen.queryByText(/Your role is read-only/)).toBeNull();
  });

  it("says plainly when there are no templates", async () => {
    open(server({ items: [] }));
    expect(await screen.findByText("No templates yet.")).toBeTruthy();
  });

  it("says why it could not load, instead of looking empty", async () => {
    open(server({ listReply: fail(500, "INTERNAL_ERROR", "Could not load templates") }));
    expect(await screen.findByText("Could not load templates")).toBeTruthy();
    expect(screen.queryByText("No templates yet.")).toBeNull();
  });
});

describe("Previewing a template", () => {
  it("shows the message filled in with a sample contact, in a sandboxed frame", async () => {
    open();
    await screen.findByText("Construction");
    fireEvent.click(screen.getByRole("button", { name: "Preview Construction" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Construction", { selector: "h2" })).toBeTruthy();
    const frame = (await within(dialog).findByTitle("Template preview")) as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    const doc = frame.getAttribute("srcdoc")!;
    expect(doc).toContain("Hello Alex at <strong>Example Co</strong> (Construction)");
    expect(doc).not.toContain("{{");
    expect(within(dialog).getByText(/The signature, the unsubscribe footer and your postal address are added when a campaign is sent/)).toBeTruthy();
  });

  it("shows only the message: no signature, footer or address", async () => {
    open();
    await screen.findByText("Construction");
    fireEvent.click(screen.getByRole("button", { name: "Preview Construction" }));
    const doc = ((await screen.findByTitle("Template preview")) as HTMLIFrameElement).getAttribute("srcdoc")!;
    expect(doc).not.toContain("<hr/>");
    expect(doc).not.toContain("Unsubscribe");
  });

  it("closes, and opens another", async () => {
    open();
    await screen.findByText("Construction");
    fireEvent.click(screen.getByRole("button", { name: "Preview Construction" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview Digital Marketing" }));
    expect(((await screen.findByTitle("Template preview")) as HTMLIFrameElement).getAttribute("srcdoc")).toContain("(Digital Marketing)");
  });

  it("says why it could not be loaded", async () => {
    open(server({ items: [BUILTINS[0]!] }));
    await screen.findByText("Automotive Services");
    // the list knows it, the detail call does not
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string, init?: RequestInit) =>
      input === "/api/email-templates/b0" ? new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Template not found", correlationId: "x" } }), { status: 404, headers: { "content-type": "application/json" } }) : original(input, init)) as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: "Preview Automotive Services" }));
    expect(await within(await screen.findByRole("dialog")).findByText("Template not found")).toBeTruthy();
  });
});

describe("Adding a template", () => {
  const openAdd = async (handler: Handler = server()) => {
    const calls = open(handler);
    await screen.findByText("Construction");
    fireEvent.click(screen.getByRole("button", { name: "Add template" }));
    await screen.findByRole("dialog");
    return calls;
  };
  const nameBox = () => screen.getByLabelText("Template name") as HTMLInputElement;
  const message = () => rte("Message");
  const submitIn = () => within(screen.getByRole("dialog")).getByRole("button", { name: "Add template" }) as HTMLButtonElement;

  it("opens a form with a name and a rich-text message with merge-field buttons, and nothing is saved until it is sent", async () => {
    const calls = await openAdd();
    expect(nameBox().value).toBe("");
    expect(message().toolbar()).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "{{firstName}}" })).toHaveLength(1);
    expect(screen.getByText(/A new template is not offered in campaigns until you add it to My Templates/)).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
  });

  it("cannot be sent until there is a name and a message", async () => {
    await openAdd();
    expect(submitIn().disabled).toBe(true);
    fireEvent.change(nameBox(), { target: { value: "My template" } });
    expect(submitIn().disabled).toBe(true); // no message yet
    message().set("<p>&nbsp;</p>");
    expect(submitIn().disabled).toBe(true); // a message of only spaces is no message
    message().set("<p>Hello {{firstName}}</p>");
    expect(submitIn().disabled).toBe(false);
    fireEvent.change(nameBox(), { target: { value: "   " } });
    expect(submitIn().disabled).toBe(true);
  });

  it("adds it: sends the trimmed name and the message exactly as written, lists it as the organization's own, and closes", async () => {
    const calls = await openAdd();
    fireEvent.change(nameBox(), { target: { value: "  Our pitch " } });
    message().set("<p>Hello {{firstName}}, <strong>welcome</strong></p>");
    fireEvent.click(submitIn());
    expect(await screen.findByText('Template "Our pitch" added')).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]).toMatchObject({ method: "POST", path: "/api/email-templates", body: { name: "Our pitch", htmlBody: "<p>Hello {{firstName}}, <strong>welcome</strong></p>" } });
    expect(Object.keys(writes(calls)[0]!.body).sort()).toEqual(["htmlBody", "name"]); // never selected, builtin or tenant
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(row("Our pitch")).getByText("Added by you")).toBeTruthy();
    expect(addBtn("Our pitch")).toBeTruthy(); // not in My Templates until it is added
  });

  it("warns about a merge field that does not exist, as the campaign editor does, before it is sent", async () => {
    await openAdd();
    fireEvent.change(nameBox(), { target: { value: "Typo" } });
    message().set("<p>Hi {{frstName}}</p>");
    expect(await screen.findByText("Unknown merge field: {{frstName}}")).toBeTruthy();
  });

  it("shows the server's reason under the name when it is taken, and keeps what was typed", async () => {
    await openAdd(server({ createReply: fail(409, "TEMPLATE_NAME_TAKEN", "A template with that name already exists", [{ path: "name", message: "A template with that name already exists" }]) }));
    fireEvent.change(nameBox(), { target: { value: "Construction" } });
    message().set("<p>Hi</p>");
    fireEvent.click(submitIn());
    expect(await screen.findByText("A template with that name already exists")).toBeTruthy();
    expect(nameBox().value).toBe("Construction");
    expect(message().value()).toBe("<p>Hi</p>");
    expect(screen.getByRole("dialog")).toBeTruthy(); // still open to fix
  });

  it("shows a message problem under the message", async () => {
    await openAdd(server({ createReply: fail(400, "VALIDATION_ERROR", "Validation failed", [{ path: "htmlBody", message: "Unknown merge field: {{nope}}" }]) }));
    fireEvent.change(nameBox(), { target: { value: "Bad" } });
    message().set("<p>Hi</p>");
    fireEvent.click(submitIn());
    expect(await screen.findByText("Unknown merge field: {{nope}}")).toBeTruthy();
  });

  it("explains any other failure", async () => {
    await openAdd(server({ createReply: fail(409, "TOO_MANY_TEMPLATES", "You can have at most 100 templates") }));
    fireEvent.change(nameBox(), { target: { value: "One too many" } });
    message().set("<p>Hi</p>");
    fireEvent.click(submitIn());
    expect(await screen.findByText("You can have at most 100 templates")).toBeTruthy();
  });

  it("starts empty again the next time it is opened, and Cancel adds nothing", async () => {
    const calls = await openAdd();
    fireEvent.change(nameBox(), { target: { value: "Half done" } });
    message().set("<p>Half</p>");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add template" }));
    await screen.findByRole("dialog");
    expect(nameBox().value).toBe("");
    expect(writes(calls)).toHaveLength(0);
  });
});
