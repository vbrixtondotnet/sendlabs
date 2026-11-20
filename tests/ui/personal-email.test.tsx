// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { PersonalEmail } from "../../src/client/pages/PersonalEmail";
import type { PersonalEmailDto } from "../../src/shared/api";
import type { Role } from "../../src/shared/types";
import { renderAt, senderDto, senderStatus, stubApi, type Call, type Handler } from "./harness";

const fail = (status: number, code: string, message: string, details?: unknown) => ({ status, json: { error: { code, message, details, correlationId: "x" } } });
const T = "2026-11-12T10:00:00.000Z";
const SENT: PersonalEmailDto[] = [
  { id: "p2", to: "bob@client.test", subject: "Second note", body: "Hello Bob,\nSecond.", sentBy: "admin@sabertoothsoftwarelabs.net", createdAt: T },
  { id: "p1", to: "jane@client.test", subject: "First note", body: "Hi Jane", sentBy: "admin@sabertoothsoftwarelabs.net", createdAt: T },
];

/** A server that remembers what was sent, like the real one. */
function server(opts: { sent?: PersonalEmailDto[]; connected?: boolean; reply?: ReturnType<typeof fail>; dailyLimit?: number; provider?: string } = {}): Handler {
  let sent = opts.sent ?? SENT;
  return ({ method, path, body }: Call) => {
    if (method === "GET" && path === "/api/sender") return { json: senderStatus(opts.connected === false ? null : senderDto()) };
    if (method === "GET" && path === "/api/personal-emails") return { json: { items: sent, sentToday: sent.length, dailyLimit: opts.dailyLimit ?? 25, provider: opts.provider ?? "gmail" } };
    if (method === "POST" && path === "/api/personal-emails") {
      if (opts.reply) return opts.reply;
      const made: PersonalEmailDto = { id: "new", to: body.to, subject: body.subject, body: body.body, sentBy: "admin@sabertoothsoftwarelabs.net", createdAt: T };
      sent = [made, ...sent];
      return { status: 201, json: made };
    }
    return undefined;
  };
}
const open = (handler: Handler = server(), role: Role = "Administrator") => {
  const calls = stubApi(handler);
  renderAt(<PersonalEmail />, { path: "/personal", route: "/personal", role });
  return calls;
};
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const sendBtn = () => screen.getByRole("button", { name: /Send email|Sending/ }) as HTMLButtonElement;

describe("One-to-one email page", () => {
  it("explains what it is for, shows the daily allowance and what was sent recently", async () => {
    open();
    expect(await screen.findByText("2 of 25 sent in the last 24 hours")).toBeTruthy();
    expect(screen.getByText(/no unsubscribe footer and no tracking/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "campaign" }).getAttribute("href")).toBe("/campaigns");
    expect(await screen.findByText("jane@client.test")).toBeTruthy();
    expect(screen.getByText("Second note")).toBeTruthy();
  });

  it("cannot send until the address, subject and message are filled in", async () => {
    open();
    await screen.findByLabelText("To");
    await waitFor(() => expect(screen.queryByText(/No Gmail account connected/)).toBeNull());
    expect(sendBtn().disabled).toBe(true);
    fill("To", "ann@client.test");
    fill("Subject", "Hello");
    expect(sendBtn().disabled).toBe(true);
    fill("Message", "Hi Ann");
    expect(sendBtn().disabled).toBe(false);
    fill("Message", "   ");
    expect(sendBtn().disabled).toBe(true);
  });

  it("sends exactly what was written, says so, clears the form and lists it", async () => {
    const calls = open();
    await screen.findByText("jane@client.test");
    fill("To", " ann@client.test ");
    fill("Subject", "  Quick question ");
    fill("Message", "Hi Ann,\n\nGot a minute?");
    await waitFor(() => expect(sendBtn().disabled).toBe(false));
    fireEvent.click(sendBtn());
    expect(await screen.findByText("Email sent to ann@client.test")).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]).toMatchObject({ method: "POST", path: "/api/personal-emails", body: { to: "ann@client.test", subject: "Quick question", body: "Hi Ann,\n\nGot a minute?" } });
    expect(Object.keys(writes(calls)[0]!.body).sort()).toEqual(["body", "subject", "to"]); // no Reply-To unless one was typed
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
    expect(await screen.findByText("3 of 25 sent in the last 24 hours")).toBeTruthy();
    expect(screen.getByText("ann@client.test")).toBeTruthy();
  });

  it("sends a Reply-To only when one is typed", async () => {
    const calls = open();
    await screen.findByText("jane@client.test");
    fill("To", "ann@client.test");
    fill("Reply-To (optional)", "boss@acme.test");
    fill("Subject", "S");
    fill("Message", "M");
    await waitFor(() => expect(sendBtn().disabled).toBe(false));
    fireEvent.click(sendBtn());
    await screen.findByText("Email sent to ann@client.test");
    expect(writes(calls)[0]!.body).toMatchObject({ replyTo: "boss@acme.test" });
  });

  it("shows the server's reason, keeps what was typed, and sends nothing more", async () => {
    open(server({ reply: fail(409, "RECIPIENT_SUPPRESSED", "This address asked not to be emailed, so it cannot be sent to") }));
    await screen.findByText("jane@client.test");
    fill("To", "gone@client.test");
    fill("Subject", "S");
    fill("Message", "M");
    await waitFor(() => expect(sendBtn().disabled).toBe(false));
    fireEvent.click(sendBtn());
    expect(await screen.findByText("This address asked not to be emailed, so it cannot be sent to")).toBeTruthy();
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("gone@client.test");
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("M");
  });

  it("tells you when no Gmail account is connected, and cannot send", async () => {
    open(server({ connected: false }));
    expect(await screen.findByText("No Gmail account connected")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    fill("To", "a@b.test");
    fill("Subject", "S");
    fill("Message", "M");
    expect(sendBtn().disabled).toBe(true);
  });

  it("with Postmark there is no Gmail account to connect: no warning, it says it is sent through Postmark, and it can send", async () => {
    const calls = open(server({ provider: "postmark", connected: false }));
    expect(await screen.findByText(/sent through Postmark/)).toBeTruthy();
    expect(screen.queryByText("No Gmail account connected")).toBeNull();
    fill("To", "ann@client.test");
    fill("Subject", "S");
    fill("Message", "M");
    await waitFor(() => expect(sendBtn().disabled).toBe(false));
    fireEvent.click(sendBtn());
    expect(await screen.findByText("Email sent to ann@client.test")).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
  });

  it("blocks sending while a merge tag is still in the message or subject, and says which", async () => {
    const calls = open();
    await screen.findByText("jane@client.test");
    fill("To", "ann@x.test");
    fill("Subject", "Ideas for {{companyName}}");
    fill("Message", "Hi Ann, I checked out {{companyName}}.");
    expect(sendBtn().disabled).toBe(true);
    expect(screen.getByText(/Replace \{\{companyName\}\} with the real text/)).toBeTruthy();
    fill("Subject", "A quick question");
    fill("Message", "Hi Ann, I checked out Acme.");
    await waitFor(() => expect(sendBtn().disabled).toBe(false));
    expect(screen.queryByText(/Replace .* with the real text/)).toBeNull();
    expect(writes(calls)).toHaveLength(0);
  });

  it("warns, without blocking, when the same message already went to others, the subject suggests a deal, or it is long", async () => {
    const pitch = "Hi Ann, I recently checked out your company and wanted to reach out. We help construction companies simplify spreadsheets, estimates and project tracking with custom software. Would you be open to a quick chat?";
    open(server({ sent: [{ id: "p9", to: "bob@client.test", subject: "Hello", body: pitch.replace("Ann", "Bob"), sentBy: "a@b.test", createdAt: T }] }));
    await screen.findByText("bob@client.test");
    fill("To", "ann@x.test");
    fill("Subject", "Sending the Contract Price");
    fill("Message", pitch);
    expect(await screen.findByText(/already sent almost this same message to 1 other address/)).toBeTruthy();
    expect(screen.getByText(/subject suggests you already have dealings/)).toBeTruthy();
    expect(sendBtn().disabled).toBe(false); // advice, not a block
    fill("Message", "word ".repeat(200));
    expect(await screen.findByText(/999 characters/)).toBeTruthy();
    expect(screen.queryByText(/already sent almost this same message/)).toBeNull();
  });

  it("stops at the daily limit", async () => {
    open(server({ dailyLimit: 2 }));
    expect(await screen.findByText("2 of 2 sent in the last 24 hours")).toBeTruthy();
    fill("To", "a@b.test");
    fill("Subject", "S");
    fill("Message", "M");
    expect(sendBtn().disabled).toBe(true);
  });

  it("opens a sent email to read it", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Second note" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("bob@client.test")).toBeTruthy();
    expect(within(dialog).getByText(/Hello Bob,/)).toBeTruthy();
  });

  it("is open to a Campaign Manager, and says no access to a Viewer", async () => {
    open(server(), "Campaign Manager");
    expect(await screen.findByLabelText("To")).toBeTruthy();
  });

  it("gives a Viewer no form and requests nothing", async () => {
    const calls = open(server(), "Viewer");
    expect(await screen.findByText("No access")).toBeTruthy();
    expect(screen.queryByLabelText("To")).toBeNull();
    expect(calls.filter((c) => c.path === "/api/personal-emails")).toHaveLength(0);
  });
});
