// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { CampaignEditor } from "../../src/client/pages/CampaignEditor";
import { Settings } from "../../src/client/pages/Settings";
import { SENDER_CONNECT_ERRORS } from "../../src/shared/types";
import type { SenderDto } from "../../src/shared/api";
import { contact, meDto, page, renderAt, senderDto, senderStatus, stubApi, type Handler } from "./harness";

// Observe where the browser is sent without actually leaving the page.
vi.mock("../../src/client/lib/navigate", () => ({ goTo: vi.fn() }));
import { goTo } from "../../src/client/lib/navigate";

const GOOGLE_URL = "https://accounts.google.com/o/oauth2/v2/auth?state=abc";
beforeEach(() => vi.mocked(goTo).mockClear());

/** A server where the tenant's sender can change as the tests act on it. */
function server(initial: SenderDto | null, opts: { configured?: boolean; connectReply?: { status: number; json: unknown } } = {}) {
  let current = initial;
  const handler: Handler = ({ method, path }) => {
    if (method === "GET" && path === "/api/sender") return { json: senderStatus(current, opts.configured ?? true) };
    if (method === "GET" && path === "/api/users") return { json: page([]) };
    if (method === "GET" && path === "/api/me") return { json: meDto() };
    if (method === "GET" && path === "/api/suppressions") return { json: page([]) };
    if (method === "GET" && path === "/api/test-recipients") return { json: { items: [] } };
    if (method === "POST" && path === "/api/sender/gmail/connect") return opts.connectReply ?? { json: { url: GOOGLE_URL } };
    if (method === "DELETE" && path === "/api/sender") { current = null; return { status: 204 }; }
    return undefined;
  };
  return handler;
}

const Probe = () => <span data-testid="search">{useLocation().search}</span>;
/** Opens Settings on the Email Service tab, where the Gmail sender lives (the Google callback lands there by itself). */
const open = (path = "/settings") => {
  const view = renderAt(<><Settings /><Probe /></>, { path, route: "/settings" });
  const tab = screen.getByRole("tab", { name: "Email Service" });
  if (tab.getAttribute("aria-selected") !== "true") fireEvent.click(tab);
  return view;
};
const connectButton = () => screen.getByRole("button", { name: /Connect Gmail|Redirecting to Google/ }) as HTMLButtonElement;

describe("Email Service tab when no Gmail account is connected", () => {
  it("shows a Connect Gmail button with a sub-label that says why it is needed", async () => {
    stubApi(server(null));
    open();
    expect(await screen.findByText("Not connected")).toBeTruthy();
    expect(connectButton().textContent).toBe("Connect Gmail");
    expect(connectButton().disabled).toBe(false);
    const label = screen.getByText(/Required to send campaigns to your leads and to invite people to your account/);
    expect(label.textContent).toMatch(/never to read your inbox/); // says what it does NOT ask for
    expect(label.textContent).toMatch(/taken to Google/);
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });

  it("starts the connection on the server, then sends the browser to Google's consent screen", async () => {
    const calls = stubApi(server(null));
    open();
    await screen.findByText("Not connected");
    fireEvent.click(connectButton());
    await waitFor(() => expect(goTo).toHaveBeenCalledWith(GOOGLE_URL));
    expect(calls.filter((c) => c.method === "POST" && c.path === "/api/sender/gmail/connect")).toHaveLength(1);
  });

  it("shows 'Redirecting to Google…' and ignores further clicks, so only one attempt starts", async () => {
    const calls = stubApi(server(null));
    open();
    await screen.findByText("Not connected");
    fireEvent.click(connectButton());
    await waitFor(() => expect(connectButton().textContent).toBe("Redirecting to Google…"));
    expect(connectButton().disabled).toBe(true);
    fireEvent.click(connectButton());
    fireEvent.click(connectButton());
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(goTo).toHaveBeenCalledTimes(1);
  });

  it("becomes usable again if the page is restored with Back from Google", async () => {
    stubApi(server(null));
    open();
    await screen.findByText("Not connected");
    fireEvent.click(connectButton());
    await waitFor(() => expect(connectButton().textContent).toBe("Redirecting to Google…"));
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    await waitFor(() => expect(connectButton().textContent).toBe("Connect Gmail"));
    expect(connectButton().disabled).toBe(false);
  });

  it("explains it when the server cannot start a connection, and stays usable", async () => {
    stubApi(server(null, { connectReply: { status: 503, json: { error: { code: "GMAIL_NOT_CONFIGURED", message: "x", correlationId: "r" } } } }));
    open();
    await screen.findByText("Not connected");
    fireEvent.click(connectButton());
    expect(await screen.findByText("Could not start the connection")).toBeTruthy();
    expect(screen.getByText("Gmail connection is not set up on this server yet.")).toBeTruthy();
    expect(goTo).not.toHaveBeenCalled();
    expect(connectButton().disabled).toBe(false);
  });

  it("shows the server's message for any other failure to start", async () => {
    stubApi(server(null, { connectReply: { status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Something went wrong", correlationId: "r" } } } }));
    open();
    await screen.findByText("Not connected");
    fireEvent.click(connectButton());
    expect(await screen.findByText("Something went wrong")).toBeTruthy();
  });

  it("when the server has no Google credentials: says so, and the button cannot be used", async () => {
    const calls = stubApi(server(null, { configured: false }));
    open();
    expect(await screen.findByText("Gmail connection is not set up on this server yet")).toBeTruthy();
    expect(screen.getByText("Not available")).toBeTruthy();
    expect(connectButton().disabled).toBe(true);
    fireEvent.click(connectButton());
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("tells you when the API is not running", async () => {
    stubApi(() => { throw new Error("offline"); });
    open();
    expect(await screen.findAllByText(/npm run dev:api/)).toBeTruthy();
  });
});

describe("Email Service tab when Gmail is connected", () => {
  it("shows the connected account and what it may do, and offers Reconnect and Disconnect instead of Connect", async () => {
    stubApi(server(senderDto()));
    open();
    expect(await screen.findByText("sales@acme.test")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    for (const label of ["Sending address", "Permission", "Connected by", "Connected on"]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("Send email")).toBeTruthy();
    expect(screen.getByText("admin@sabertoothsoftwarelabs.net")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Gmail" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/refresh|access token|pbkdf2|Bearer/i);
  });

  it("Reconnect runs the same flow", async () => {
    const calls = stubApi(server(senderDto()));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(goTo).toHaveBeenCalledWith(GOOGLE_URL));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/sender/gmail/connect")).toBe(true);
  });

  it("asks before disconnecting, and says exactly what will stop working", async () => {
    const calls = stubApi(server(senderDto()));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog", { name: "Disconnect Gmail?" });
    expect(within(dialog).getByText("sales@acme.test")).toBeTruthy();
    expect(dialog.textContent).toMatch(/Campaigns cannot be sent and invitations cannot be emailed/);
    expect(dialog.textContent).toMatch(/already sent are not affected/);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep connected" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(screen.getByText("sales@acme.test")).toBeTruthy();
  });

  it("disconnects on confirmation, and the tab goes back to offering Connect Gmail", async () => {
    const calls = stubApi(server(senderDto()));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/sender")).toBe(true));
    expect(await screen.findByRole("button", { name: "Connect Gmail" })).toBeTruthy();
    expect(screen.queryByText("sales@acme.test")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the account shown, and says why, if disconnecting fails", async () => {
    stubApi((c) => (c.method === "DELETE" ? { status: 403, json: { error: { code: "FORBIDDEN", message: "Your access level does not allow this", correlationId: "r" } } } : server(senderDto())(c)));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("Your access level does not allow this")).toBeTruthy();
    expect(screen.getByText("sales@acme.test", { selector: "dd" })).toBeTruthy(); // the account is still listed
    expect(screen.getByRole("dialog")).toBeTruthy(); // and the dialog stays open so you can try again
  });

  it("says plainly when Google no longer accepts the saved permission", async () => {
    stubApi(server(senderDto({ status: "NeedsReconnect" })));
    open();
    expect(await screen.findByText("Needs reconnecting")).toBeTruthy();
    expect(screen.getByText("Reconnect to keep sending")).toBeTruthy();
    expect(screen.queryByText("Connected", { selector: "span" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
  });
});

describe("coming back from Google", () => {
  it("confirms a successful connection and cleans the address, so a refresh does not repeat it", async () => {
    stubApi(server(senderDto()));
    open("/settings?sender=connected");
    expect(await screen.findByText("Gmail connected")).toBeTruthy(); // the confirmation
    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe(""));
    expect(screen.queryByText("Gmail was not connected")).toBeNull();
    expect(await screen.findByText("sales@acme.test")).toBeTruthy(); // the account is there
  });

  it("explains every failure code in plain words, and cleans the address", async () => {
    const seen = new Set<string>();
    for (const reason of SENDER_CONNECT_ERRORS) {
      stubApi(server(null));
      const view = open(`/settings?sender=error&reason=${reason}`);
      expect(await screen.findByText("Gmail was not connected"), reason).toBeTruthy();
      const text = screen.getByText("Gmail was not connected").parentElement!.textContent!;
      expect(text.length, reason).toBeGreaterThan(40);
      expect(text).not.toContain(reason); // a person never sees the code itself
      expect(seen.has(text), `${reason} has its own explanation`).toBe(false);
      seen.add(text);
      await waitFor(() => expect(screen.getByTestId("search").textContent).toBe(""));
      view.unmount();
    }
    expect(seen.size).toBe(SENDER_CONNECT_ERRORS.length);
  });

  it("tells people what to do for the cases they can fix themselves", async () => {
    stubApi(server(null));
    open("/settings?sender=error&reason=missing_permission");
    expect(await screen.findByText(/leave the box for sending email ticked/)).toBeTruthy();
  });

  it("treats an unknown code safely, as a generic failure, never printing it", async () => {
    stubApi(server(null));
    open("/settings?sender=error&reason=%3Cscript%3Ealert(1)%3C%2Fscript%3E");
    expect(await screen.findByText("Gmail was not connected")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("<script>alert");
    expect(screen.getByText(/Google did not accept the connection/)).toBeTruthy();
  });

  it("lets you dismiss the failure message", async () => {
    stubApi(server(null));
    open("/settings?sender=error&reason=denied");
    await screen.findByText("Gmail was not connected");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Gmail was not connected")).toBeNull();
  });
});

describe("campaigns are sent from the connected account", () => {
  const contactsAnd = (sender: Handler): Handler => (c) =>
    sender(c) ?? (c.path === "/api/email-templates" && c.method === "GET" ? { json: { items: [] } } : c.path === "/api/me" && c.method === "GET" ? { json: meDto() } : c.path === "/api/contacts" && c.method === "GET" ? { json: page([contact()], 5) } : c.path === "/api/imports" && c.method === "GET" ? { json: page([]) } : undefined);
  const editor = () => renderAt(<CampaignEditor />, { path: "/campaigns/new", route: "/campaigns/new" });
  const fillBasics = () => {
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "N" } });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "S" } });
  };
  const launch = () => screen.getByRole("button", { name: "Review and launch" }) as HTMLButtonElement;
  const sender = (s: SenderDto | null): Handler => ({ method, path }) => (method === "GET" && path === "/api/sender" ? { json: senderStatus(s) } : undefined);

  it("blocks launching, and says how to fix it, when no account is connected", async () => {
    stubApi(contactsAnd(sender(null)));
    editor();
    fillBasics();
    expect(await screen.findByText("Connect a Gmail sender in Settings before launching")).toBeTruthy();
    expect(launch().disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "preview" }));
    expect(screen.getByText("(no sender connected)")).toBeTruthy();
  });

  it("shows the real sending address, and does not block, when an account is connected", async () => {
    stubApi(contactsAnd(sender(senderDto({ email: "sales@acme.test" }))));
    editor();
    fillBasics();
    await waitFor(() => expect(launch().disabled).toBe(false));
    expect(screen.queryByText(/Connect a Gmail sender/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "preview" }));
    expect(screen.getByText("Ada Lovelace <sales@acme.test>")).toBeTruthy(); // in the name of the person sending, as the emails are
    expect(document.body.textContent).not.toContain("itimpact"); // the made-up mailbox is gone
  });

  it("blocks launching until the account is reconnected", async () => {
    stubApi(contactsAnd(sender(senderDto({ status: "NeedsReconnect" }))));
    editor();
    fillBasics();
    expect(await screen.findByText("Reconnect your Gmail sender in Settings before launching")).toBeTruthy();
    expect(launch().disabled).toBe(true);
  });

  it("waits for the answer instead of guessing", async () => {
    stubApi(contactsAnd(() => new Promise(() => undefined) as never));
    editor();
    fillBasics();
    expect(launch().disabled).toBe(true);
  });
});
