// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CampaignEditor } from "../../src/client/pages/CampaignEditor";
import type { MeDto } from "../../src/shared/api";
import { rte } from "./rte";
import { campaign, contact, page, renderAt, senderStatus, stubApi, testRecipientDto, type Handler } from "./harness";

/** Who is signed in. The signature of a new campaign is built from this. */
const meDto = (user: Partial<MeDto["user"]> = {}, tenant: Partial<MeDto["tenant"]> = {}): MeDto => ({
  user: { id: "u1", email: "rico@sabertooth.test", firstName: "Rico", lastName: "Prinsipe", position: "Marketing Admin", displayName: "Rico Prinsipe", access: "Administrator", mustChangePassword: false, ...user },
  tenant: { id: "t", name: "Sabertooth Software Labs", slug: "sabertooth", postalAddress: ADDRESS, website: "sabertoothsoftwarelabs.net", requireUnsubscribeLink: true, oneClickUnsubscribe: true, ...tenant },
  session: true,
});
const ADDRESS = "Sabertooth Software Labs\n1 Example Street\nManila, Philippines";
const FOOTER_TEXT = "You're receiving this email because we believe our services may be relevant to your business.";
/** The starting signature: the sign-off, name, position | company and website, as the HTML the signature editor holds. */
const SIGNATURE = "<p>Best regards,<br/>Rico Prinsipe<br/>Marketing Admin | Sabertooth Software Labs<br/>sabertoothsoftwarelabs.net</p>";
const bodyField = rte("Email body");
const sigField = rte("Email signature");

const contacts: Handler = ({ method, path }) =>
  path === "/api/contacts" && method === "GET" ? { json: page([contact()], 8214) }
    : path === "/api/me" && method === "GET" ? { json: meDto() }
    : path === "/api/test-recipients" && method === "GET" ? { json: { items: [] } }
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
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE)); // who you are has loaded
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
      sendWindowStart: "10:30", sendWindowEnd: "16:45", timezone: "America/Los_Angeles", textBody: null, signature: SIGNATURE,
    });
    expect(body.htmlBody).not.toContain("{{unsubscribeUrl}}"); // the body is just the message; the footer is added for you
    expect(body.htmlBody).not.toContain("{{signature}}");
    expect(Object.keys(body).sort()).toEqual(["dailyLimit", "htmlBody", "name", "recipientImportId", "sendWindowEnd", "sendWindowStart", "signature", "subject", "textBody", "timezone"]); // never status or owner
    expect(body.recipientImportId).toBeNull(); // all contacts
    expect(await screen.findByTestId("elsewhere")).toBeTruthy(); // back to the list
  });

  it("has no plain-text body field any more, and never sends one", async () => {
    const calls = stubApi((c) => (c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign() } : contacts(c)));
    newCampaign();
    expect(screen.queryByLabelText("Plain-text body (optional)")).toBeNull();
    expect(screen.queryByText(/Plain-text body/)).toBeNull();
    fill("Campaign name", "N");
    fill("Subject", "S");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.textBody).toBeNull();
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

  it("blocks launch for unknown merge fields and a reversed window, but never for a missing unsubscribe link", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE)); // who you are has loaded
    fill("Campaign name", "N");
    fill("Subject", "Hi {{firstNmae}}"); // typo
    fireEvent.click(screen.getByRole("tab", { name: "edit" }));
    bodyField.set("<p>no link</p>");
    fill("Window start", "18:00");
    expect(await screen.findByText(/Unknown merge field: \{\{firstNmae\}\}/)).toBeTruthy();
    expect(screen.getByText("The send window must end after it starts")).toBeTruthy();
    expect(screen.queryByText(/must include an/)).toBeNull(); // the standard footer provides the link, so there is nothing to ask for
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
    const draft = campaign({ id: "k1", name: "Old name", subject: "Old subject", dailyLimit: 250, sendWindowStart: "08:00", signature: "<p>Cheers,<br/>Zed</p>" });
    const calls = stubApi((c) => {
      if (c.path === "/api/campaigns/k1" && c.method === "GET") return { json: draft };
      if (c.path === "/api/campaigns/k1" && c.method === "PATCH") return { json: draft };
      return contacts(c);
    });
    editCampaign();
    expect(await screen.findByDisplayValue("Old name")).toBeTruthy();
    expect((screen.getByLabelText("Max emails per day") as HTMLInputElement).value).toBe("250");
    expect((screen.getByLabelText("Window start") as HTMLInputElement).value).toBe("08:00");
    expect(sigField.value()).toBe("<p>Cheers,<br/>Zed</p>");

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

  describe("test send", () => {
    const allowlisted = (items = [testRecipientDto(), testRecipientDto({ id: "t2", email: "pm@acme.test" })]): Handler => (c) =>
      c.path === "/api/test-recipients" && c.method === "GET" ? { json: { items } } : contacts(c);
    const testButton = () => screen.getByRole("button", { name: "Send test email" }) as HTMLButtonElement;

    it("shows who a test goes to, with no field to type another address", async () => {
      stubApi(allowlisted());
      newCampaign();
      expect(await screen.findByText("qa@acme.test")).toBeTruthy();
      expect(screen.getByText("pm@acme.test")).toBeTruthy();
      expect(screen.queryByLabelText("Send a test to")).toBeNull();
    });

    it("is disabled, and says why, when the allowlist is empty (an Administrator is pointed to Settings)", async () => {
      stubApi(allowlisted([]));
      newCampaign();
      fill("Campaign name", "N");
      fill("Subject", "S");
      expect(await screen.findByText(/No test addresses yet/)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Add one in Settings" }).getAttribute("href")).toBe("/settings");
      expect(testButton().disabled).toBe(true);
    });

    it("tells a Campaign Manager to ask an Administrator instead of linking to Settings", async () => {
      stubApi(allowlisted([]));
      renderAt(<CampaignEditor />, { path: "/campaigns/new", route: "/campaigns/new", role: "Campaign Manager" });
      expect(await screen.findByText(/Ask an Administrator/)).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Add one in Settings" })).toBeNull();
    });

    it("saves the draft, then asks the server to test-send it with no addresses in the request", async () => {
      const calls = stubApi((c) =>
        c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign({ id: "new1" }) }
          : c.method === "POST" && c.path === "/api/campaigns/new1/test-send" ? { json: { sent: ["qa@acme.test", "pm@acme.test"] } }
          : allowlisted()(c),
      );
      newCampaign();
      await screen.findByText("qa@acme.test");
      fill("Campaign name", "N");
      fill("Subject", "S");
      await waitFor(() => expect(testButton().disabled).toBe(false));
      fireEvent.click(testButton());
      expect(await screen.findByText("Test sent to qa@acme.test, pm@acme.test")).toBeTruthy();
      const order = calls.filter((c) => c.method === "POST").map((c) => c.path);
      expect(order).toEqual(["/api/campaigns", "/api/campaigns/new1/test-send"]);
      expect(calls.find((c) => c.path.endsWith("/test-send"))!.body).toBeUndefined();
      expect(screen.queryByTestId("elsewhere")).toBeNull(); // stays in the editor
    });

    it("sends a second test by updating the same draft, not by creating another", async () => {
      const calls = stubApi((c) =>
        c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign({ id: "new1" }) }
          : c.method === "PATCH" && c.path === "/api/campaigns/new1" ? { json: campaign({ id: "new1" }) }
          : c.method === "POST" && c.path.endsWith("/test-send") ? { json: { sent: ["qa@acme.test"] } }
          : allowlisted()(c),
      );
      newCampaign();
      await screen.findByText("qa@acme.test");
      fill("Campaign name", "N");
      fill("Subject", "S");
      await waitFor(() => expect(testButton().disabled).toBe(false));
      fireEvent.click(testButton());
      await waitFor(() => expect(calls.filter((c) => c.path.endsWith("/test-send"))).toHaveLength(1));
      await waitFor(() => expect(testButton().disabled).toBe(false));
      fireEvent.click(testButton());
      await waitFor(() => expect(calls.filter((c) => c.path.endsWith("/test-send"))).toHaveLength(2));
      expect(calls.filter((c) => c.method === "POST" && c.path === "/api/campaigns")).toHaveLength(1);
      expect(calls.some((c) => c.method === "PATCH" && c.path === "/api/campaigns/new1")).toBe(true);
    });

    it("shows the server's reason when the test cannot be sent", async () => {
      stubApi((c) =>
        c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign({ id: "new1" }) }
          : c.method === "POST" && c.path.endsWith("/test-send") ? { status: 409, json: { error: { code: "SENDER_RECONNECT", message: "Reconnect your Gmail account in Settings before sending a test" } } }
          : allowlisted()(c),
      );
      newCampaign();
      await screen.findByText("qa@acme.test");
      fill("Campaign name", "N");
      fill("Subject", "S");
      await waitFor(() => expect(testButton().disabled).toBe(false));
      fireEvent.click(testButton());
      expect((await screen.findByRole("alert")).textContent).toContain("Reconnect your Gmail account");
    });

    it("is disabled until the draft could be saved (name and subject)", async () => {
      stubApi(allowlisted());
      newCampaign();
      await screen.findByText("qa@acme.test");
      expect(testButton().disabled).toBe(true);
    });
  });
});

describe("Email signature", () => {
  const withMe = (me: MeDto | null, extra?: Handler): Handler => (c) => extra?.(c) ?? (c.path === "/api/me" ? (me ? { json: me } : { status: 401, json: { error: { code: "NO_ACTIVE_USER", message: "Not signed in", correlationId: "x" } } }) : contacts(c));
  const previewDoc = async () => {
    fireEvent.click(screen.getByRole("tab", { name: "preview" }));
    return ((await screen.findByTitle("Rendered email preview")) as HTMLIFrameElement).getAttribute("srcdoc")!;
  };

  it("is pre-filled for a new campaign from the signed-in user and their company", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    expect(sigField.value().replace(/<\/?p>/g, "").split("<br/>")).toEqual(["Best regards,", "Rico Prinsipe", "Marketing Admin | Sabertooth Software Labs", "sabertoothsoftwarelabs.net"]);
  });

  it("follows who is signed in: another user, position, company and website", async () => {
    stubApi(withMe(meDto({ displayName: "Ada Lovelace", position: "CTO" }, { name: "Acme Inc.", website: "acme.test" })));
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe("<p>Best regards,<br/>Ada Lovelace<br/>CTO | Acme Inc.<br/>acme.test</p>"));
  });

  it("leaves out the position separator when there is no position, and the website line when there is no website", async () => {
    stubApi(withMe(meDto({ position: "" }, { website: "" })));
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe("<p>Best regards,<br/>Rico Prinsipe<br/>Sabertooth Software Labs</p>"));
  });

  it("is simply empty if who you are cannot be loaded, and can still be typed", async () => {
    stubApi(withMe(null));
    newCampaign();
    await screen.findByLabelText("Campaign name");
    await new Promise((r) => setTimeout(r, 30));
    expect(sigField.value()).toBe("");
    sigField.set("<p>Thanks</p>");
    expect(sigField.value()).toBe("<p>Thanks</p>");
  });

  it("is fully editable, and what you typed is not overwritten once who you are has loaded", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    stubApi(contacts);
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      if (input === "/api/me") await gate;
      return original(input, init);
    }) as typeof fetch;
    newCampaign();
    await screen.findByLabelText("Campaign name");
    sigField.set("<p>My own sign-off</p>"); // typed before /api/me answered
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(sigField.value()).toBe("<p>My own sign-off</p>");
  });

  it("is saved with the draft, exactly as edited", async () => {
    const calls = stubApi((c) => (c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign({ id: "n" }) } : contacts(c)));
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    fill("Campaign name", "N");
    fill("Subject", "S");
    sigField.set("<p>Warmly,<br/>Rico</p>");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.signature).toBe("<p>Warmly,<br/>Rico</p>");
  });

  it("can be emptied, and then nothing is added to the preview or saved", async () => {
    const calls = stubApi((c) => (c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign({ id: "n" }) } : contacts(c)));
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    fill("Campaign name", "N");
    fill("Subject", "S");
    sigField.set("");
    const doc = await previewDoc();
    expect(doc).not.toContain("Rico Prinsipe");
    expect(doc).not.toContain("{{signature}}");
    fireEvent.click(screen.getByRole("tab", { name: "edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.signature).toBe("");
  });

  it("an existing draft keeps its own signature, even an empty one, and is not re-filled", async () => {
    for (const saved of ["Cheers,\nZed", ""]) {
      stubApi((c) => (c.path === "/api/campaigns/k1" && c.method === "GET" ? { json: campaign({ id: "k1", signature: saved }) } : contacts(c)));
      const view = editCampaign();
      await screen.findByDisplayValue("Access-to-SQL");
      await new Promise((r) => setTimeout(r, 30));
      expect(sigField.value()).toBe(saved);
      view.unmount();
    }
  });

  it("shows in the preview, right after the body and before the footer", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    const doc = await previewDoc();
    expect(doc).toContain("Best regards,<br/>Rico Prinsipe<br/>Marketing Admin | Sabertooth Software Labs<br/>sabertoothsoftwarelabs.net");
    expect(doc).not.toContain("{{signature}}");
    expect(doc.indexOf("Would a short call")).toBeLessThan(doc.indexOf("Rico Prinsipe")); // after the body
    expect(doc.indexOf("Rico Prinsipe")).toBeLessThan(doc.indexOf("Unsubscribe")); // before the footer
  });

  it("the preview follows what is typed", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    sigField.set("<p>Yours truly,<br/>Someone Else</p>");
    const doc = await previewDoc();
    expect(doc).toContain("Yours truly,<br/>Someone Else");
    expect(doc).not.toContain("Rico Prinsipe");
  });

  it("is added after the body, whatever the body says", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    bodyField.set("<p>Short note {{unsubscribeUrl}}</p>");
    const doc = await previewDoc();
    expect(doc.indexOf("Short note")).toBeLessThan(doc.indexOf("Rico Prinsipe"));
    expect(doc.trimEnd().endsWith("</p></body></html>")).toBe(true);
  });

  it("stays right after the body: an old {{signature}} tag left in a body does not move it, and is not shown", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    bodyField.set("<p>Top</p>{{signature}}<p>Bottom</p>");
    const doc = await previewDoc();
    expect(doc).not.toContain("{{signature}}");
    expect(doc.indexOf("Bottom")).toBeLessThan(doc.indexOf("Rico Prinsipe"));
  });

  it("keeps its formatting in the preview: bold, links and line breaks show as they will be sent", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    sigField.set('<p>Thanks,<br/><strong>Rico</strong> &amp; team<br/><a href="https://acme.test">acme.test</a></p>');
    const doc = await previewDoc();
    expect(doc).toContain('<p>Thanks,<br/><strong>Rico</strong> &amp; team<br/><a href="https://acme.test">acme.test</a></p>');
  });

  it("fills merge fields typed into it, like the body", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    sigField.set("<p>P.S. for {{firstName}}</p>");
    expect(await previewDoc()).toContain("P.S. for Nick");
  });

  it("has no {{signature}} button any more, and the starting body does not mention it", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    expect(screen.queryByRole("button", { name: "{{signature}}" })).toBeNull();
    expect(bodyField.value()).not.toContain("{{signature}}");
    expect(screen.queryByText(/Unknown merge field/)).toBeNull();
    sigField.set("<p>Hi {{nope}}</p>");
    expect(await screen.findByText(/Unknown merge field: {{nope}}/)).toBeTruthy(); // typos in the signature are caught too
  });

  it("shows the server's reason under it if it is refused (too long)", async () => {
    stubApi((c) =>
      c.method === "POST" && c.path === "/api/campaigns"
        ? { status: 400, json: { error: { code: "VALIDATION_ERROR", message: "Validation failed", details: [{ path: "signature", message: "Use at most 5000 characters" }], correlationId: "x" } } }
        : contacts(c),
    );
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    fill("Campaign name", "N");
    fill("Subject", "S");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect((await screen.findAllByText("Use at most 5000 characters")).length).toBeGreaterThan(0);
  });

  it("is not part of the old plain-text field: there is only one place to write a sign-off", async () => {
    stubApi(contacts);
    newCampaign();
    expect(screen.getAllByRole("textbox", { name: "Email signature" })).toHaveLength(1);
  });
});

describe("Compliance in the editor", () => {
  const launch = () => screen.getByRole("button", { name: "Review and launch" }) as HTMLButtonElement;
  const withMe = (me: MeDto): Handler => (c) => (c.path === "/api/me" ? { json: me } : contacts(c));
  const previewDoc = async () => {
    fireEvent.click(screen.getByRole("tab", { name: "preview" }));
    return ((await screen.findByTitle("Rendered email preview")) as HTMLIFrameElement).getAttribute("srcdoc")!;
  };
  const ready = async () => {
    await waitFor(() => expect(sigField.value()).not.toBe(""));
    fill("Campaign name", "N");
    fill("Subject", "S");
  };

  it("adds the company's postal address to the footer of the preview, one line per line, escaped", async () => {
    stubApi(withMe(meDto({}, { postalAddress: "Acme & Sons\n<1> Road\nManila" })));
    newCampaign();
    await ready();
    const doc = await previewDoc();
    expect(doc).toContain('<p style="font-size:12px;color:#666666">Acme &amp; Sons<br/>&lt;1&gt; Road<br/>Manila</p>');
    expect(doc.indexOf("Unsubscribe")).toBeLessThan(doc.indexOf("Acme &amp; Sons")); // after the whole message
    expect(doc.indexOf("Rico Prinsipe")).toBeLessThan(doc.indexOf("Acme &amp; Sons")); // and after the signature
  });

  it("does not make up a footer when the company has no address, and the starting body no longer carries a placeholder one", async () => {
    stubApi(withMe(meDto({}, { postalAddress: "" })));
    newCampaign();
    await ready();
    const doc = await previewDoc();
    expect(doc).not.toContain("Example Street");
    expect(doc).not.toContain("IT Impact");
    expect(doc).not.toContain("font-size:12px;color:#666666\">Sabertooth"); // no footer paragraph from the address
  });

  it("blocks launching until the company has a postal address, and tells an Administrator where to add it", async () => {
    stubApi(withMe(meDto({}, { postalAddress: "" })));
    newCampaign();
    await ready();
    expect(await screen.findByText("Add your company's postal address in Settings > Company Details before launching")).toBeTruthy();
    expect(launch().disabled).toBe(true);
  });

  it("tells a Campaign Manager to ask an Administrator", async () => {
    stubApi(withMe(meDto({ access: "Campaign Manager" }, { postalAddress: "" })));
    renderAt(<CampaignEditor />, { path: "/campaigns/new", route: "/campaigns/new", role: "Campaign Manager" });
    await ready();
    expect(await screen.findByText(/Ask an Administrator to add the company's postal address/)).toBeTruthy();
    expect(launch().disabled).toBe(true);
  });

  it("does not ask for a postal address that is there", async () => {
    stubApi(withMe(meDto()));
    newCampaign();
    await ready();
    await waitFor(() => expect(launch().disabled).toBe(false));
    expect(screen.queryByText(/Add your company's postal address|Ask an Administrator to add the company's postal address/)).toBeNull();
  });

  it("never asks for an unsubscribe link: a body with none can be launched, because the footer adds one", async () => {
    stubApi(withMe(meDto()));
    newCampaign();
    await ready();
    bodyField.set("<p>No link here</p>");
    await waitFor(() => expect(launch().disabled).toBe(false));
    expect(screen.queryByText(/must include an/)).toBeNull();
  });

  it("does not ask either when the company turned the requirement off", async () => {
    stubApi(withMe(meDto({}, { requireUnsubscribeLink: false })));
    newCampaign();
    await ready();
    bodyField.set("<p>No link here</p>");
    await waitFor(() => expect(launch().disabled).toBe(false));
  });

  it("says in the preview note that the address is added to every email", async () => {
    stubApi(withMe(meDto()));
    newCampaign();
    await ready();
    await previewDoc();
    expect(screen.getByText(/the body, then the signature, then the standard unsubscribe footer \(not editable\); your company's postal address is added after that automatically/)).toBeTruthy();
  });
});

describe("The standard unsubscribe footer", () => {
  const previewDoc = async () => {
    fireEvent.click(screen.getByRole("tab", { name: "preview" }));
    return ((await screen.findByTitle("Rendered email preview")) as HTMLIFrameElement).getAttribute("srcdoc")!;
  };
  const withMe = (me: MeDto): Handler => (c) => (c.path === "/api/me" ? { json: me } : contacts(c));
  const FOOTER_HTML = `<hr/>
<p style="font-size:12px;color:#666;">
You're receiving this email because we believe our services may be relevant to your business.<br/>
<a href="https://example.invalid/unsubscribe/preview-token">Unsubscribe</a><br/>
Sabertooth Software Labs
</p>`;

  it("is not a field any more: there is nothing to type, and nothing in the form holds it", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    expect(screen.queryByLabelText("Footer")).toBeNull();
    expect(screen.queryByText("Footer")).toBeNull();
    for (const el of screen.getAllByRole("textbox")) {
      const text = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : (el.textContent ?? "");
      expect(text, el.getAttribute("aria-label") ?? el.id).not.toContain(FOOTER_TEXT);
    }
  });

  it("is added to the preview exactly as given, with the company's name on the last line", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    const doc = await previewDoc();
    expect(doc).toContain(FOOTER_HTML);
  });

  it("comes after the body and the signature, and before the postal address: body, signature, footer, address", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    const doc = await previewDoc();
    const at = (needle: string) => doc.indexOf(needle);
    expect(at("Would a short call")).toBeLessThan(at("Rico Prinsipe"));
    expect(at("Rico Prinsipe")).toBeLessThan(at("<hr/>"));
    expect(at("<hr/>")).toBeLessThan(at(FOOTER_TEXT));
    expect(at(FOOTER_TEXT)).toBeLessThan(at("Unsubscribe</a>"));
    expect(at("Unsubscribe</a>")).toBeLessThan(at("1 Example Street"));
  });

  it("is added whatever the body says, and follows the body as it is edited", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    bodyField.set("<p>Totally different message</p>");
    const doc = await previewDoc();
    expect(doc).toContain("Totally different message");
    expect(doc).toContain(FOOTER_HTML);
  });

  it("shows the sending company's name, even when the person previewed works for another company", async () => {
    stubApi(withMe(meDto({}, { name: "Smith & <b>Sons</b>" })));
    newCampaign();
    await waitFor(() => expect(sigField.value()).toContain("Smith &amp; &lt;b&gt;Sons&lt;/b&gt;"));
    bodyField.set("<p>Hello {{companyName}}</p>");
    const doc = await previewDoc();
    expect(doc).toContain("<p>Hello Flexecution</p>"); // the body's merge field is the contact's company
    expect(doc).toContain("<br/>\nSmith &amp; &lt;b&gt;Sons&lt;/b&gt;\n</p>"); // the footer is ours, escaped
  });

  it("is left out of the preview when the company does not require an unsubscribe link", async () => {
    stubApi(withMe(meDto({}, { requireUnsubscribeLink: false })));
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    const doc = await previewDoc();
    expect(doc).not.toContain(FOOTER_TEXT);
    expect(doc).not.toContain("<hr/>");
  });

  it("is in the preview even before who you are has loaded (the default is on)", async () => {
    stubApi((c) => (c.path === "/api/me" ? { status: 500, json: { error: { code: "INTERNAL_ERROR", message: "x", correlationId: "x" } } } : contacts(c)));
    newCampaign();
    await screen.findByLabelText("Campaign name");
    const doc = await previewDoc();
    expect(doc).toContain(FOOTER_TEXT);
  });

  it("does not stop a body from having its own {{unsubscribeUrl}} link too", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    bodyField.set('<p><a href="{{unsubscribeUrl}}">stop</a></p>');
    expect(screen.queryByText(/Unknown merge field/)).toBeNull();
    const doc = await previewDoc();
    expect(doc.split("https://example.invalid/unsubscribe/preview-token")).toHaveLength(3);
  });

  it("is not saved with the draft: nothing named footer is sent", async () => {
    const calls = stubApi((c) => (c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign({ id: "n" }) } : contacts(c)));
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    fill("Campaign name", "N");
    fill("Subject", "S");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const body = calls.find((c) => c.method === "POST")!.body;
    expect("footer" in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain(FOOTER_TEXT);
  });

  it("the email body is just the message: it says what is added after it, and starts with no footer", async () => {
    stubApi(contacts);
    newCampaign();
    expect(bodyField.value()).not.toMatch(/\{\{signature\}\}|\{\{unsubscribeUrl\}\}|Unsubscribe|<hr|Best regards/i);
    expect(screen.getByText(/Just the message\. The signature, the standard unsubscribe footer and your postal address are added after it automatically/)).toBeTruthy();
  });
});

describe("From in the editor's preview", () => {
  const withMe = (me: MeDto): Handler => (c) => (c.path === "/api/me" ? { json: me } : contacts(c));
  const fromLine = async () => {
    fireEvent.click(screen.getByRole("tab", { name: "preview" }));
    return (await screen.findByText("From")).nextElementSibling!.textContent;
  };

  it("shows the logged-in user's full name with the connected address, as the recipients will see it", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.value()).toBe(SIGNATURE));
    expect(await fromLine()).toBe("Rico Prinsipe <sales@acme.test>");
  });

  it("follows who is signed in", async () => {
    stubApi(withMe(meDto({ displayName: "Ada Lovelace" })));
    newCampaign();
    await waitFor(() => expect(sigField.value()).toContain("Ada Lovelace"));
    expect(await fromLine()).toBe("Ada Lovelace <sales@acme.test>");
  });

  it("is just the address for a user with no name", async () => {
    stubApi(withMe(meDto({ displayName: "" })));
    newCampaign();
    await screen.findByLabelText("Campaign name");
    await waitFor(() => expect(sigField.value()).not.toBe(""));
    expect(await fromLine()).toBe("sales@acme.test");
  });

  it("is just the address until who you are has loaded", async () => {
    stubApi((c) => (c.path === "/api/me" ? { status: 500, json: { error: { code: "INTERNAL_ERROR", message: "x", correlationId: "x" } } } : contacts(c)));
    newCampaign();
    await screen.findByLabelText("Campaign name");
    expect(await fromLine()).toBe("sales@acme.test");
  });
});

describe("Rich text editors in the Message section", () => {
  type Ed = { commands: { insertContent: (c: string) => boolean; selectAll: () => boolean; focus: (p?: string) => boolean; deleteSelection: () => boolean }; getHTML: () => string };
  /** The editor library's editor behind a field's editing area: what typing and shortcuts would drive. */
  const editorOf = (field: ReturnType<typeof rte>) => (field.area() as unknown as { editor: Ed }).editor;
  const typeInto = (field: ReturnType<typeof rte>, text: string) => act(() => { editorOf(field).commands.focus("end"); editorOf(field).commands.insertContent(text); });
  const clear = (field: ReturnType<typeof rte>) => act(() => { editorOf(field).commands.selectAll(); editorOf(field).commands.deleteSelection(); });
  const bold = (field: ReturnType<typeof rte>) => { act(() => { editorOf(field).commands.selectAll(); }); fireEvent.click(within(field.toolbar()).getByRole("button", { name: "Bold" })); };
  const previewDoc = async () => {
    fireEvent.click(screen.getByRole("tab", { name: "preview" }));
    return ((await screen.findByTitle("Rendered email preview")) as HTMLIFrameElement).getAttribute("srcdoc")!;
  };
  const ready = async () => { await waitFor(() => expect(sigField.value()).toBe(SIGNATURE)); fireEvent.click(within(sigField.toolbar()).getByRole("button", { name: "HTML source" })); };
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  const saveCalls = () => stubApi((c) => (c.method === "POST" && c.path === "/api/campaigns" ? { status: 201, json: campaign({ id: "n" }) } : contacts(c)));

  it("has a rich-text editor for the email body and one for the signature, under the Edit tab", async () => {
    stubApi(contacts);
    newCampaign();
    await ready();
    expect(screen.getByRole("tab", { name: "edit" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "preview" })).toBeTruthy();
    for (const label of ["Email body", "Email signature"]) {
      expect(rte(label).toolbar(), label).toBeTruthy();
    }
    expect(screen.queryByLabelText("HTML body")).toBeNull(); // the old plain HTML box is gone
  });

  it("the body editor is the full one with merge-field buttons; the signature editor is the shorter one with none", async () => {
    stubApi(contacts);
    newCampaign();
    await ready();
    const bodyBar = within(bodyField.toolbar());
    for (const name of ["Bold", "Link", "Bulleted list", "Numbered list", "Quote", "Horizontal line", "HTML source"]) expect(bodyBar.getByRole("button", { name }), name).toBeTruthy();
    expect(bodyBar.getByRole("combobox", { name: "Text style" })).toBeTruthy();
    const sigBar = within(sigField.toolbar());
    for (const name of ["Bold", "Italic", "Link", "HTML source"]) expect(sigBar.getByRole("button", { name }), name).toBeTruthy();
    for (const name of ["Bulleted list", "Quote", "Horizontal line"]) expect(sigBar.queryByRole("button", { name }), name).toBeNull();
    expect(screen.getAllByRole("button", { name: "{{firstName}}" })).toHaveLength(1); // the body's only
  });

  it("the starting body and signature show as formatted text, not as markup", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    expect(bodyField.area().querySelectorAll("p").length).toBe(3);
    expect(bodyField.area().textContent).toContain("Hi {{firstName}},");
    expect(bodyField.area().textContent).not.toContain("<p>");
    expect(sigField.area().querySelectorAll("br").length).toBe(3);
    expect(sigField.area().textContent).not.toContain("<p>");
  });

  it("typing in the body is what is saved, as HTML", async () => {
    const calls = saveCalls();
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    clear(bodyField);
    typeInto(bodyField, "Brand new message");
    fill("Campaign name", "N");
    fill("Subject", "S");
    save();
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.htmlBody).toBe("<p>Brand new message</p>");
  });

  it("formatting in the body is saved and shown in the preview", async () => {
    const calls = saveCalls();
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    clear(bodyField);
    typeInto(bodyField, "Plain words");
    bold(bodyField);
    const doc = await previewDoc();
    expect(doc).toContain("<strong>Plain words</strong>");
    fireEvent.click(screen.getByRole("tab", { name: "edit" }));
    fill("Campaign name", "N");
    fill("Subject", "S");
    save();
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.htmlBody).toContain("<strong>Plain words</strong>");
  });

  it("typing in the signature is saved as HTML and shown in the preview, before the footer", async () => {
    const calls = saveCalls();
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    clear(sigField);
    typeInto(sigField, "Cheers, Rico");
    bold(sigField);
    const doc = await previewDoc();
    expect(doc).toContain("<p><strong>Cheers, Rico</strong></p>");
    expect(doc.indexOf("Cheers, Rico")).toBeLessThan(doc.indexOf("<hr/>"));
    fireEvent.click(screen.getByRole("tab", { name: "edit" }));
    fill("Campaign name", "N");
    fill("Subject", "S");
    save();
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.signature).toBe("<p><strong>Cheers, Rico</strong></p>");
  });

  it("clearing the signature saves an empty one, not an empty paragraph, and adds nothing to the preview", async () => {
    const calls = saveCalls();
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    clear(sigField);
    const doc = await previewDoc();
    expect(doc).not.toContain("Rico Prinsipe");
    fireEvent.click(screen.getByRole("tab", { name: "edit" }));
    fill("Campaign name", "N");
    fill("Subject", "S");
    save();
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.signature).toBe("");
  });

  it("an empty body is reported as required, and blocks launching, like the empty textarea did", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    fill("Campaign name", "N");
    fill("Subject", "S");
    clear(bodyField);
    expect(await screen.findByText("Email body is required")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review and launch" }) as HTMLButtonElement).disabled).toBe(true);
    typeInto(bodyField, "Now there is something");
    await waitFor(() => expect(screen.queryByText("Email body is required")).toBeNull());
  });

  it("a body that is only spaces counts as empty too", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    bodyField.set("<p>&nbsp;</p>");
    expect(await screen.findByText("Email body is required")).toBeTruthy();
  });

  it("the merge-field buttons sit above the Email body, each light yellow", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    const insert = screen.getByText("Insert:");
    const label = screen.getByText("Email body", { selector: "div" });
    expect(insert.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(insert.compareDocumentPosition(bodyField.area()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: /^\{\{\w+\}\}$/ });
    expect(buttons.length).toBe(10); // the nine merge fields and the unsubscribe link
    for (const b of buttons) expect(b.className, b.textContent ?? "").toContain("bg-amber-100");
  });

  it("merge fields in the starting message are highlighted in the body, and once inserted too", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    const marks = () => [...bodyField.area().querySelectorAll(".merge-tag")].map((el) => el.textContent);
    expect(marks()).toEqual(["{{firstName}}", "{{companyName}}"]);
    act(() => { editorOf(bodyField).commands.focus("end"); });
    fireEvent.click(screen.getByRole("button", { name: "{{city}}" }));
    expect(marks()).toEqual(["{{firstName}}", "{{companyName}}", "{{city}}"]);
    typeInto(bodyField, " {{frstName}}");
    expect([...bodyField.area().querySelectorAll(".merge-tag-unknown")].map((el) => el.textContent)).toEqual(["{{frstName}}"]);
  });

  it("the highlight is not saved: the body is sent exactly as written", async () => {
    const calls = saveCalls();
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    clear(bodyField);
    typeInto(bodyField, "Hi ");
    fireEvent.click(screen.getByRole("button", { name: "{{firstName}}" }));
    fill("Campaign name", "N");
    fill("Subject", "S");
    save();
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.htmlBody).toBe("<p>Hi {{firstName}}</p>");
  });

  it("a merge-field button puts the tag in the body at the cursor, and nowhere else", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    clear(bodyField);
    typeInto(bodyField, "Hello ");
    fireEvent.click(screen.getByRole("button", { name: "{{companyName}}" }));
    expect(editorOf(bodyField).getHTML()).toBe("<p>Hello {{companyName}}</p>");
    expect(editorOf(sigField).getHTML()).not.toContain("{{companyName}}");
  });

  it("an unknown merge field typed into the body is flagged, as before", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    typeInto(bodyField, " {{frstName}}");
    expect(await screen.findByText(/Unknown merge field: \{\{frstName\}\}/)).toBeTruthy();
  });

  it("switching to the preview and back keeps what was written, formatting included", async () => {
    stubApi(contacts);
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    clear(bodyField);
    typeInto(bodyField, "Keep me");
    bold(bodyField);
    await previewDoc();
    fireEvent.click(screen.getByRole("tab", { name: "edit" }));
    expect(bodyField.area().querySelector("strong")!.textContent).toBe("Keep me");
    expect(sigField.area().textContent).toContain("Rico Prinsipe");
  });

  it("an existing draft opens with its saved body and signature shown formatted", async () => {
    stubApi((c) => (c.path === "/api/campaigns/k1" && c.method === "GET" ? { json: campaign({ id: "k1", htmlBody: "<p>Hello <em>there</em></p>", signature: "<p>Thanks,<br/><strong>Zed</strong></p>" }) } : contacts(c)));
    editCampaign();
    await screen.findByDisplayValue("Access-to-SQL");
    expect(bodyField.area().querySelector("em")!.textContent).toBe("there");
    expect(sigField.area().querySelector("strong")!.textContent).toBe("Zed");
  });

  it("saving an existing draft without touching the body or signature sends them exactly as they were, even custom HTML the editor cannot show", async () => {
    const custom = '<table><tr><td style="color:red">Cell</td></tr></table><p onclick="x()">Hi {{firstName}}</p>';
    const sig = '<div style="font-size:11px">Zed<br/>Team</div>';
    const calls = stubApi((c) => {
      if (c.path === "/api/campaigns/k1" && c.method === "GET") return { json: campaign({ id: "k1", htmlBody: custom, signature: sig }) };
      if (c.path === "/api/campaigns/k1" && c.method === "PATCH") return { json: campaign({ id: "k1" }) };
      return contacts(c);
    });
    editCampaign();
    await screen.findByDisplayValue("Access-to-SQL");
    fill("Campaign name", "Renamed");
    save();
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const sent = calls.find((c) => c.method === "PATCH")!.body;
    expect(sent.htmlBody).toBe(custom);
    expect(sent.signature).toBe(sig);
  });

  it("the HTML button lets hand-written markup be saved exactly as typed", async () => {
    const calls = saveCalls();
    newCampaign();
    await waitFor(() => expect(sigField.area().textContent).toContain("Rico Prinsipe"));
    bodyField.set("<table><tr><td>Hand written</td></tr></table>");
    fill("Campaign name", "N");
    fill("Subject", "S");
    save();
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body.htmlBody).toBe("<table><tr><td>Hand written</td></tr></table>");
  });
});
