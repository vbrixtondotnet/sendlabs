// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Imports } from "../../src/client/pages/Imports";
import { importDto, page, renderAt, stubApi, type Handler } from "./harness";

const template = readFileSync("public/template.csv", "utf8");
const withErrors = readFileSync("public/sample-with-errors.csv", "utf8");

const csvFile = (text: string, name = "leads.csv") => new File([text], name, { type: "text/csv" });
const history = (items = [importDto({ id: "old1", filename: "older.csv", createdContacts: 10, existingContacts: 2 })]): Handler => ({ method, path }) =>
  path === "/api/imports" && method === "GET" ? { json: page(items) } : undefined;

/** Chooses a file the way the browser does, and waits for the mapping step. */
async function choose(text: string, name?: string) {
  const input = screen.getByLabelText("CSV file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [csvFile(text, name)] } });
  await screen.findByText("Column mapping", { exact: false }).catch(() => null);
  await screen.findByRole("button", { name: "Validate rows" });
}

describe("Imports page (live)", () => {
  it("lists real import history, with a rejected-rows download only where there are rejected rows", async () => {
    stubApi(history([
      importDto({ id: "a", filename: "clean.csv", rejectedRows: 0 }),
      importDto({ id: "b", filename: "messy.csv", rejectedRows: 6, status: "Completed" }),
      importDto({ id: "c", filename: "broken.csv", status: "Failed", createdContacts: 0 }),
    ]));
    renderAt(<Imports />);
    expect(await screen.findByText("messy.csv")).toBeTruthy();
    const rowOf = (name: string) => screen.getByText(name).closest("tr")!;
    expect(within(rowOf("messy.csv")).getByRole("link", { name: "Rejected rows" }).getAttribute("href")).toBe("/api/imports/b/rejected-rows.csv");
    expect(within(rowOf("clean.csv")).queryByRole("link", { name: "Rejected rows" })).toBeNull();
    expect(within(rowOf("broken.csv")).getByText("Failed")).toBeTruthy();
  });

  it("says so when there is no history yet, and when the API is down", async () => {
    stubApi(history([]));
    const first = renderAt(<Imports />);
    expect(await screen.findByText("No imports yet.")).toBeTruthy();
    first.unmount();

    stubApi(() => { throw new Error("offline"); });
    renderAt(<Imports />);
    expect(await screen.findByText(/npm run dev:api/)).toBeTruthy();
  });

  it("walks through upload, mapping and review, then uploads the file and the mapping to the server", async () => {
    const calls = stubApi((c) => (c.method === "POST" && c.path === "/api/imports" ? { status: 201, json: importDto({ id: "new1", filename: "leads.csv" }) } : history()(c)));
    renderAt(<Imports />);
    await choose(template);

    // every template column was mapped automatically
    expect((screen.getByLabelText(/^Email/) as HTMLSelectElement).value).toBe("4");
    expect((screen.getByLabelText("First Name") as HTMLSelectElement).value).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Validate rows" }));

    expect(await screen.findByText("Total rows")).toBeTruthy(); // the browser's own preview
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save 25 contacts" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/imports")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.form!.file.name).toBe("leads.csv");
    expect(await post.form!.file.text()).toBe(template); // the original file, untouched
    expect(post.form!.mapping).toMatchObject({ email: 4, firstName: 0, companyName: 3, annualRevenue: 12 });

    expect(await screen.findByText("Import complete")).toBeTruthy();
    expect(screen.getByText(/25 new contacts saved from leads\.csv/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View contacts" })).toBeTruthy();
  });

  it("shows the server's own counts, not the preview's, and says when they differ", async () => {
    stubApi((c) =>
      c.method === "POST"
        ? { status: 201, json: importDto({ id: "n", filename: "leads.csv", totalRows: 25, validRows: 20, createdContacts: 12, existingContacts: 8, rejectedRows: 5, counts: { malformed: 5, badRow: 0, duplicate: 0, blank: 0 } }) }
        : history()(c),
    );
    renderAt(<Imports />);
    await choose(template);
    fireEvent.click(screen.getByRole("button", { name: "Validate rows" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and save 25 contacts" }));
    expect(await screen.findByText(/12 new contacts saved/)).toBeTruthy();
    expect(screen.getByText(/8 already existed and were left unchanged/)).toBeTruthy();
    expect(screen.getByText(/5 rows were not imported/)).toBeTruthy();
    expect(screen.getByText(/server counted 20 valid rows, but the preview showed 25/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download rejected rows" }).getAttribute("href")).toBe("/api/imports/n/rejected-rows.csv");
  });

  it("previews bad rows in the browser before anything is sent", async () => {
    const calls = stubApi(history());
    renderAt(<Imports />);
    await choose(withErrors, "errors.csv");
    fireEvent.click(screen.getByRole("button", { name: "Validate rows" }));
    expect(await screen.findByText("Rows that will not be imported (6)")).toBeTruthy();
    expect(screen.getByText("maria.lopez@baddomain")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm and save 26 contacts" })).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false); // nothing leaves the browser until confirmed
  });

  it("keeps the review open with the server's reason, and allows trying again", async () => {
    let attempt = 0;
    const calls = stubApi((c) => {
      if (c.method === "POST") {
        attempt++;
        return attempt === 1
          ? { status: 500, json: { error: { code: "IMPORT_FAILED", message: "The import could not be completed. Upload the file again to finish.", correlationId: "ref-77" } } }
          : { status: 201, json: importDto({ id: "n2" }) };
      }
      return history()(c);
    });
    renderAt(<Imports />);
    await choose(template);
    fireEvent.click(screen.getByRole("button", { name: "Validate rows" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and save 25 contacts" }));

    expect(await screen.findByText("The import did not complete")).toBeTruthy();
    expect(screen.getByText(/finishes the job without creating duplicates/)).toBeTruthy();
    expect(screen.getByText("Reference: ref-77")).toBeTruthy();
    expect(screen.queryByText("Import complete")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Confirm and save 25 contacts" }));
    expect(await screen.findByText("Import complete")).toBeTruthy();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });

  it("disables Confirm while saving, so a double click cannot import twice", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const calls: string[] = [];
    stubApi((c) => (c.method === "POST" ? (calls.push("post"), { status: 201, json: importDto() }) : history()(c)));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      if ((args[1] as RequestInit | undefined)?.method === "POST") await gate;
      return realFetch(...args);
    }) as typeof fetch;

    renderAt(<Imports />);
    await choose(template);
    fireEvent.click(screen.getByRole("button", { name: "Validate rows" }));
    const confirm = await screen.findByRole("button", { name: "Confirm and save 25 contacts" });
    fireEvent.click(confirm);
    const busy = (await screen.findByRole("button", { name: "Saving contacts…" })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    fireEvent.click(busy);
    release();
    expect(await screen.findByText("Import complete")).toBeTruthy();
    expect(calls).toEqual(["post"]);
  });

  it("rejects files it cannot use without calling the server", async () => {
    const calls = stubApi(history());
    renderAt(<Imports />);
    const input = screen.getByLabelText("CSV file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile("a,b\n1,2", "leads.xlsx")] } });
    expect(await screen.findByText("Only .csv files are accepted.")).toBeTruthy();
    fireEvent.change(input, { target: { files: [csvFile("PK\u0003\u0004binary", "x.csv")] } });
    expect(await screen.findByText(/binary file, not a CSV/)).toBeTruthy();
    fireEvent.change(input, { target: { files: [csvFile("Email\n", "h.csv")] } });
    expect(await screen.findByText(/header row and at least one data row/)).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("will not continue without an email column", async () => {
    stubApi(history());
    renderAt(<Imports />);
    await choose("Name,Org\nPat,Acme\n");
    expect(screen.getByText("Choose which column holds the email address.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Validate rows" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is read-only for a Viewer, but still shows history", async () => {
    stubApi(history());
    renderAt(<Imports />, { role: "Viewer" });
    expect(await screen.findByText("older.csv")).toBeTruthy();
    expect(screen.queryByLabelText("CSV file")).toBeNull();
    expect(screen.getByText(/read-only/)).toBeTruthy();
  });
});
