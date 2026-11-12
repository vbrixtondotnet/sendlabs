// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CampaignEditor } from "../../src/client/pages/CampaignEditor";
import { campaign, contact, importDto, meDto, page, renderAt, senderStatus, stubApi, type Handler } from "./harness";

const template = readFileSync("public/sample-contacts.csv", "utf8");
const ready = importDto({ id: "imp-ready", filename: "q4-leads.csv", validRows: 7968, createdAt: "2026-11-01T10:00:00.000Z" });
const failed = importDto({ id: "imp-failed", filename: "broken.csv", status: "Failed", validRows: 0 });

const world = (extra?: Handler): Handler => (c) =>
  extra?.(c) ??
  (c.path === "/api/contacts" && c.method === "GET" ? { json: page([contact()], 8214) }
    : c.path === "/api/imports" && c.method === "GET" ? { json: page([ready, failed]) }
    : c.path === "/api/sender" && c.method === "GET" ? { json: senderStatus() }
    : c.path === "/api/me" && c.method === "GET" ? { json: meDto() }
    : c.path === "/api/email-templates" && c.method === "GET" ? { json: { items: [] } }
    : undefined);

const fresh = () => renderAt(<CampaignEditor />, { path: "/campaigns/new", route: "/campaigns/new" });
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const fillBasics = () => { fill("Campaign name", "N"); fill("Subject", "S"); };

describe("campaign recipients (saved with the draft)", () => {
  it("defaults to all contacts, shows the real count, and saves null", async () => {
    const calls = stubApi(world((c) => (c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign({ id: "n" }) } : undefined)));
    fresh();
    expect(await screen.findByText(/Every contact in your database \(8,214\)/)).toBeTruthy();
    fillBasics();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/campaigns")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.recipientImportId).toBeNull();
  });

  it("lists the tenant's industries, lets you tick several, counts them, and saves the list", async () => {
    const calls = stubApi(world((c) =>
      c.path === "/api/contacts/industries" ? { json: { items: ["construction", "retail", "wholesale"], counts: { construction: 120, retail: 30, wholesale: 5 } } }
      : c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign({ id: "n" }) } : undefined));
    fresh();
    fillBasics();
    expect(screen.queryByRole("tab", { name: "An import" })).toBeNull(); // replaced by Industries
    tab("Industries");
    await screen.findByLabelText(/construction/);
    expect(screen.getByText("Choose at least one industry for the recipients")).toBeTruthy(); // launch blocked until you do

    fireEvent.click(screen.getByLabelText(/construction/));
    fireEvent.click(screen.getByLabelText(/wholesale/));
    await waitFor(() => expect(screen.queryByText("Choose at least one industry for the recipients")).toBeNull());
    expect(screen.getByText("Will be emailed").nextSibling!.textContent).toBe("125");

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/campaigns")).toBe(true));
    const body = calls.find((c) => c.method === "POST")!.body;
    expect(body.recipientIndustries).toEqual(["construction", "wholesale"]);
    expect(body.recipientImportId).toBeNull();
  });

  it("reopens a draft with its industries already ticked", async () => {
    stubApi(world((c) =>
      c.path === "/api/contacts/industries" ? { json: { items: ["construction", "retail"], counts: { construction: 120, retail: 30 } } }
      : c.path === "/api/campaigns/k1" && c.method === "GET" ? { json: campaign({ id: "k1", recipientIndustries: ["retail"] }) } : undefined));
    renderAt(<CampaignEditor />, { path: "/campaigns/k1/edit", route: "/campaigns/:id/edit" });
    const retail = (await screen.findByLabelText(/retail/)) as HTMLInputElement;
    expect(retail.checked).toBe(true);
    expect((screen.getByLabelText(/construction/) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("tab", { name: "Industries" }).getAttribute("aria-selected")).toBe("true");
  });

  it("changing a draft back to all contacts clears the industries", async () => {
    const calls = stubApi(world((c) => {
      if (c.path === "/api/campaigns/k1" && c.method === "GET") return { json: campaign({ id: "k1", recipientIndustries: ["retail"] }) };
      if (c.path === "/api/campaigns/k1" && c.method === "PATCH") return { json: campaign({ id: "k1" }) };
      return undefined;
    }));
    renderAt(<CampaignEditor />, { path: "/campaigns/k1/edit", route: "/campaigns/:id/edit" });
    await screen.findByText("Industries");
    tab("All contacts");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body.recipientIndustries).toEqual([]);
  });

  it("reopens an older draft that used an import, showing which one", async () => {
    stubApi(world((c) => (c.path === "/api/campaigns/k1" && c.method === "GET" ? { json: campaign({ id: "k1", recipientImportId: "imp-ready" }) } : undefined)));
    renderAt(<CampaignEditor />, { path: "/campaigns/k1/edit", route: "/campaigns/:id/edit" });
    expect(await screen.findByText("q4-leads.csv")).toBeTruthy();
  });
});

describe("uploading a CSV from the editor", () => {
  async function chooseFile(text: string, name = "new-leads.csv") {
    tab("Upload CSV");
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [new File([text], name, { type: "text/csv" })] } });
    return screen.findByRole("button", { name: /Import \d+ contacts and use them/ });
  }

  it("blocks launch until the file is imported, and does not upload on its own", async () => {
    const calls = stubApi(world());
    fresh();
    fillBasics();
    const button = await chooseFile(template);
    expect(screen.getByText("Import the uploaded CSV first (use the button in Recipients)")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review and launch" }) as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toBe("Import 25 contacts and use them");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("imports for real, then selects that import as the recipients and saves its id", async () => {
    const calls = stubApi(world((c) => {
      if (c.method === "POST" && c.path === "/api/imports") return { status: 201, json: importDto({ id: "imp-new", filename: "new-leads.csv", validRows: 25, createdContacts: 20, existingContacts: 5 }) };
      if (c.method === "POST" && c.path === "/api/campaigns") return { status: 201, json: campaign({ id: "n" }) };
      if (c.path === "/api/imports" && c.method === "GET") {
        const fresh = calls.some((x) => x.method === "POST" && x.path === "/api/imports");
        return { json: page(fresh ? [importDto({ id: "imp-new", filename: "new-leads.csv", validRows: 25 }), ready] : [ready]) };
      }
      return undefined;
    }));
    fresh();
    fillBasics();
    fireEvent.click(await chooseFile(template));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/imports")).toBe(true));
    const up = calls.find((c) => c.path === "/api/imports" && c.method === "POST")!;
    expect(up.form!.file.name).toBe("new-leads.csv");
    expect(up.form!.mapping).toMatchObject({ email: 4 });

    // the new import is now the audience, and launch is no longer blocked
    expect(await screen.findByText("new-leads.csv")).toBeTruthy();
    expect(screen.getByText("Will be emailed").nextSibling!.textContent).toBe("25");
    expect(await screen.findByText(/Imported 20 new contacts\. 25 will be emailed/)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Review and launch" }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/campaigns")).toBe(true));
    expect(calls.find((c) => c.path === "/api/campaigns" && c.method === "POST")!.body.recipientImportId).toBe("imp-new");
  });

  it("keeps the file and shows the reason if the server rejects the import", async () => {
    stubApi(world((c) =>
      c.method === "POST" && c.path === "/api/imports"
        ? { status: 422, json: { error: { code: "INVALID_CSV", message: "The file has an unclosed quote.", correlationId: "x" } } }
        : undefined,
    ));
    fresh();
    fireEvent.click(await chooseFile(template));
    expect(await screen.findByText("The import did not complete")).toBeTruthy();
    expect(screen.getByText("The file has an unclosed quote.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Import 25 contacts and use them/ })).toBeTruthy(); // can try again
    expect(screen.getByRole("tab", { name: "Upload CSV" }).getAttribute("aria-selected")).toBe("true");
  });

  it("will not offer to import a file with no valid rows", async () => {
    stubApi(world());
    fresh();
    tab("Upload CSV");
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [new File(["Email\nnot-an-email\n"], "bad.csv", { type: "text/csv" })] } });
    const button = (await screen.findByRole("button", { name: "Import 0 contacts and use them" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("previews with a row of the uploaded file before it is imported", async () => {
    stubApi(world());
    fresh();
    await chooseFile(template);
    fireEvent.click(screen.getAllByRole("tab", { name: "preview" })[0]!);
    const select = (await screen.findByLabelText("Preview as")) as HTMLSelectElement;
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toContain("Nick Harbaugh"); // the first row of the sample file, not the database's first contact
  });
});
