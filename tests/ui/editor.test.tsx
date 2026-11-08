// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CampaignEditor } from "../../src/client/pages/CampaignEditor";
import { campaign, contact, page, renderAt, senderStatus, stubApi, type Handler } from "./harness";

const contacts: Handler = ({ method, path }) =>
  path === "/api/contacts" && method === "GET" ? { json: page([contact()], 8214) }
    : path === "/api/imports" && method === "GET" ? { json: page([]) }
    : path === "/api/sender" && method === "GET" ? { json: senderStatus() }
    : undefined;

const newCampaign = () => renderAt(<CampaignEditor />, { path: "/campaigns/new", route: "/campaigns/new" });
const editCampaign = () => renderAt(<CampaignEditor />, { path: "/campaigns/k1/edit", route: "/campaigns/:id/edit" });

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Campaign editor (live drafts)", () => {
  it("saves a new draft with exactly what was entered, and the schedule", async () => {
    const calls = stubApi((c) => (c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign({ id: "new1" }) } : contacts(c)));
    newCampaign();
    fill("Campaign name", "Access-to-SQL");
    fill("Subject", "Hi {{firstName}}");
    fill("Max emails per day", "300");
    fill("Window start", "10:30");
    fill("Window end", "16:45");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/campaigns")).toBe(true));
    const body = calls.find((c) => c.method === "POST")!.body;
    expect(body).toMatchObject({
      name: "Access-to-SQL", subject: "Hi {{firstName}}", dailyLimit: 300,
      sendWindowStart: "10:30", sendWindowEnd: "16:45", timezone: "America/Los_Angeles", textBody: null,
    });
    expect(body.htmlBody).toContain("{{unsubscribeUrl}}");
    expect(Object.keys(body).sort()).toEqual(["dailyLimit", "htmlBody", "name", "recipientImportId", "sendWindowEnd", "sendWindowStart", "subject", "textBody", "timezone"]); // never status or owner
    expect(body.recipientImportId).toBeNull(); // all contacts
    expect(await screen.findByTestId("elsewhere")).toBeTruthy(); // back to the list
  });

  it("sends the plain-text body when one is given", async () => {
    const calls = stubApi((c) => (c.method === "POST" ? { status: 201, json: campaign() } : contacts(c)));
    newCampaign();
    fill("Campaign name", "N");
    fill("Subject", "S");
    fill("Plain-text body (optional)", "Hello there");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.textBody).toBe("Hello there");
  });

  it("shows the server's field errors and stays on the page", async () => {
    stubApi((c) =>
      c.method === "POST"
        ? { status: 400, json: { error: { code: "VALIDATION_ERROR", message: "Validation failed", details: [{ path: "name", message: "Name is required" }], correlationId: "ref-7" } } }
        : contacts(c),
    );
    newCampaign();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Could not save the draft")).toBeTruthy();
    expect(screen.getAllByText(/Name is required/).length).toBeGreaterThanOrEqual(2); // inline and in the summary
    expect(screen.getByText("Reference: ref-7")).toBeTruthy();
    expect(screen.queryByTestId("elsewhere")).toBeNull();
  });

  it("lists what blocks launching, and unblocks as the form is completed", async () => {
    stubApi(contacts);
    newCampaign();
    await screen.findAllByText("8,214", { exact: false }); // the contact count has loaded
    const launch = screen.getByRole("button", { name: "Review and launch" }) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    expect(screen.getByText("Campaign name is required")).toBeTruthy();
    expect(screen.getByText("Subject is required")).toBeTruthy();

    fill("Campaign name", "N");
    fill("Subject", "S");
    await waitFor(() => expect(launch.disabled).toBe(false));
    expect(screen.queryByText("Before you can launch")).toBeNull();
  });

  it("blocks launch for a missing unsubscribe link, unknown merge fields and a reversed window", async () => {
    stubApi(contacts);
    newCampaign();
    fill("Campaign name", "N");
    fill("Subject", "Hi {{firstNmae}}"); // typo
    fireEvent.click(screen.getByRole("tab", { name: "edit" }));
    fill("HTML body", "<p>no link</p>");
    fill("Window start", "18:00");
    expect(await screen.findByText("Body must include an {{unsubscribeUrl}} link")).toBeTruthy();
    expect(screen.getByText(/Unknown merge field: \{\{firstNmae\}\}/)).toBeTruthy();
    expect(screen.getByText("The send window must end after it starts")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review and launch" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("previews with a real contact, escaping HTML in the values", async () => {
    stubApi(({ method, path }) =>
      path === "/api/contacts" && method === "GET" ? { json: page([contact({ firstName: "<b>Nick</b>", companyName: "Flexecution" })]) } : undefined,
    );
    newCampaign();
    await screen.findByText("1 sending day", { exact: false }).catch(() => null);
    fireEvent.click(screen.getByRole("tab", { name: "preview" }));
    const frame = (await screen.findByTitle("Rendered email preview")) as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe(""); // no scripts, no same-origin access
    const doc = frame.getAttribute("srcdoc")!;
    expect(doc).toContain("&lt;b&gt;Nick&lt;/b&gt;");
    expect(doc).not.toContain("<b>Nick</b>");
    expect(screen.getByText("nick@flexecutioninc.com")).toBeTruthy();
  });

  it("the launch dialog saves a draft and says plainly that launching is not connected", async () => {
    const calls = stubApi((c) => (c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign({ id: "new1" }) } : contacts(c)));
    newCampaign();
    fill("Campaign name", "N");
    fill("Subject", "S");
    const launch = screen.getByRole("button", { name: "Review and launch" }) as HTMLButtonElement;
    await waitFor(() => expect(launch.disabled).toBe(false)); // waits for the recipient count
    fireEvent.click(launch);
    const dialog = await screen.findByRole("dialog", { name: "Review launch" });
    expect(within(dialog).getByText(/Launching is not connected to the backend yet/)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: /Save draft \(launch not connected\)/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // needs both acknowledgements
    fireEvent.click(within(dialog).getByLabelText(/previewed the email/));
    fireEvent.click(within(dialog).getByLabelText(/unsubscribe link and sender postal address/));
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(await screen.findByTestId("elsewhere")).toBeTruthy();
  });

  it("loads an existing draft into the form and saves changes with a PATCH", async () => {
    const draft = campaign({ id: "k1", name: "Old name", subject: "Old subject", dailyLimit: 250, sendWindowStart: "08:00", textBody: "plain" });
    const calls = stubApi((c) => {
      if (c.path === "/api/campaigns/k1" && c.method === "GET") return { json: draft };
      if (c.path === "/api/campaigns/k1" && c.method === "PATCH") return { json: draft };
      return contacts(c);
    });
    editCampaign();
    expect(await screen.findByDisplayValue("Old name")).toBeTruthy();
    expect((screen.getByLabelText("Max emails per day") as HTMLInputElement).value).toBe("250");
    expect((screen.getByLabelText("Window start") as HTMLInputElement).value).toBe("08:00");
    expect((screen.getByLabelText("Plain-text body (optional)") as HTMLTextAreaElement).value).toBe("plain");

    fill("Campaign name", "New name");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ name: "New name", subject: "Old subject", dailyLimit: 250 });
  });

  it("refuses to edit a campaign that has been launched", async () => {
    stubApi((c) => (c.path === "/api/campaigns/k1" ? { json: campaign({ id: "k1", status: "Sending" }) } : contacts(c)));
    editCampaign();
    expect(await screen.findByText("This campaign is locked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.getByRole("link", { name: "View the campaign" }).getAttribute("href")).toBe("/campaigns/k1");
  });

  it("is unavailable to a Viewer", async () => {
    stubApi(contacts);
    renderAt(<CampaignEditor />, { path: "/campaigns/new", route: "/campaigns/new", role: "Viewer" });
    expect(await screen.findByText(/read-only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });

  it("does not claim to send test emails", async () => {
    stubApi(contacts);
    newCampaign();
    expect((screen.getByRole("button", { name: "Send test email" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
