// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { JobApplyPanel, draftApplication } from "../../src/client/components/JobApplyPanel";
import type { JobDto } from "../../src/shared/api";
import { ATTACHMENT_ACCEPT, MAX_TOTAL_ATTACHMENT_BYTES } from "../../src/shared/email-attachments";
import { meDto, renderAt, senderDto, senderStatus, stubApi, type Call, type Handler } from "./harness";

const job: JobDto = {
  id: "remotive:1", title: "Senior .NET Developer", companyName: "Acme Corp", companyLogo: "", category: "Software Development", employmentType: "Full-time", remote: true,
  location: "Worldwide", salary: "", skills: [], url: "https://remotive.com/remote-jobs/software-dev/job-1", source: "Remotive", publishedAt: null,
};

const base: Handler = ({ path, method }) =>
  path === "/api/me" ? { json: meDto() }
  : path === "/api/sender" ? { json: senderStatus(senderDto({ email: "sales@acme.test" })) }
  : path === "/api/jobs/apply-email" && method === "POST" ? { json: { sent: true, attachments: 0 } }
  : undefined;

const open = (handler: Handler = base, role: "Administrator" | "Campaign Manager" | "Viewer" = "Administrator", onClose = () => undefined) => {
  const calls = stubApi(handler);
  renderAt(<JobApplyPanel job={job} onClose={onClose} />, { role });
  return calls;
};
const panel = () => screen.getByRole("dialog", { name: "Apply by email" });
const sendCall = (calls: Call[]) => calls.find((c) => c.path === "/api/jobs/apply-email");
const file = (name: string, size = 10, type = "") => new File([new Uint8Array(size).fill(1)], name, { type });
const attach = (...files: File[]) => fireEvent.change(screen.getByLabelText("Attach files"), { target: { files } });
const fillTo = (v = "hiring@acme.test") => fireEvent.change(screen.getByLabelText("To"), { target: { value: v } });
const sendButton = () => screen.getByRole("button", { name: /Send email|Sending/ }) as HTMLButtonElement;

describe("the Apply panel", () => {
  it("is a panel that slides in from the right, named for the job, with a way to close it", async () => {
    let closed = 0;
    open(base, "Administrator", () => { closed++; });
    const p = panel();
    expect(p.getAttribute("aria-modal")).toBe("true");
    expect(p.className).toContain("slide-in-right");
    expect(p.className).toContain("right-0");
    expect(within(p).getByText("Senior .NET Developer · Acme Corp")).toBeTruthy();
    fireEvent.click(within(p).getByRole("button", { name: "Close panel" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closed).toBe(2);
    expect(within(p).queryByText(/View the original job posting/)).toBeNull(); // that link now lives in the View Job panel, not here
    expect(within(p).queryByRole("link")).toBeNull();
  });

  it("has To, Subject, Message and Attachments, and no CC or BCC", async () => {
    open();
    await screen.findByText(/sales@acme.test/);
    for (const label of ["To", "Subject", "Message", "Attach files"]) expect(screen.getByLabelText(label), label).toBeTruthy();
    expect(screen.queryByLabelText(/^cc/i)).toBeNull();
    expect(screen.queryByLabelText(/bcc/i)).toBeNull();
    expect(screen.queryByText(/\bcc\b|\bbcc\b/i)).toBeNull();
    expect(screen.getByText("sales@acme.test")).toBeTruthy(); // who it is sent from
  });

  it("starts with a personalised email from the job and from you, ready to edit", async () => {
    open();
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Application for Senior .NET Developer at Acme Corp");
    await waitFor(() => expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toContain("Best regards,\nAda Lovelace")); // your name arrives with /api/me
    const body = (screen.getByLabelText("Message") as HTMLTextAreaElement).value;
    expect(body).toContain("Hello Acme Corp team,");
    expect(body).toContain("apply for the Senior .NET Developer position at Acme Corp");
    expect(body.trim().endsWith("Best regards,\nAda Lovelace")).toBe(true);
    expect(draftApplication({ title: "Cook", companyName: "" }, "Sam")).toEqual({ subject: "Application for Cook", body: expect.stringContaining("Hello,\n\nI am writing to apply for the Cook position.") });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "My own words" } });
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("My own words");
  });

  it("sends only when there is a valid address, a subject and a message", async () => {
    open();
    await screen.findByText(/sales@acme.test/);
    expect(sendButton().disabled).toBe(true); // no address yet
    fillTo("not-an-email");
    expect(sendButton().disabled).toBe(true);
    fillTo();
    expect(sendButton().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "  " } });
    expect(sendButton().disabled).toBe(true);
  });

  it("sends the words and the files as a form to our server, and closes with a confirmation", async () => {
    let closed = 0;
    const calls = open(base, "Administrator", () => { closed++; });
    await screen.findByText(/sales@acme.test/);
    fillTo(" hiring@acme.test ");
    attach(file("resume.pdf", 2000, "application/pdf"), file("cover.docx"));
    fireEvent.click(sendButton());
    await waitFor(() => expect(closed).toBe(1));
    const call = sendCall(calls)!;
    expect(call.method).toBe("POST");
    const form = call.formData!;
    expect([...form.keys()].sort()).toEqual(["attachments", "attachments", "body", "subject", "to"]); // no cc, no bcc, nothing else
    expect(form.get("to")).toBe("hiring@acme.test");
    expect(form.get("subject")).toBe("Application for Senior .NET Developer at Acme Corp");
    expect(form.getAll("attachments").map((f) => (f as File).name)).toEqual(["resume.pdf", "cover.docx"]);
    expect(screen.queryByRole("dialog")).toBeTruthy(); // the host decides to unmount it: the callback was called
  });

  it("shows the server's reason when sending fails, keeps what was written, and lets the person try again", async () => {
    let fail = true;
    const calls = open(({ path, method, ...rest }) => (path === "/api/jobs/apply-email" ? (fail ? { status: 409, json: { error: { code: "SENDER_RECONNECT", message: "Google no longer accepts your Gmail connection. Reconnect it in Settings, then try again" } } } : { json: { sent: true, attachments: 0 } }) : base({ path, method, ...rest } as Call)));
    await screen.findByText(/sales@acme.test/);
    fillTo();
    fireEvent.click(sendButton());
    expect(await screen.findByText("Google no longer accepts your Gmail connection. Reconnect it in Settings, then try again")).toBeTruthy();
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("hiring@acme.test");
    fail = false;
    fireEvent.click(sendButton());
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/jobs/apply-email")).toHaveLength(2));
  });

  it("cannot send for a role that only looks, or when no Gmail account is connected, and says why", async () => {
    open(base, "Viewer");
    expect(await screen.findByText("Your role cannot send email")).toBeTruthy();
    fillTo();
    expect(sendButton().disabled).toBe(true);
  });

  it("asks to connect Gmail first when the organization has none", async () => {
    open(({ path, method, ...rest }) => (path === "/api/sender" ? { json: senderStatus(null) } : base({ path, method, ...rest } as Call)));
    expect(await screen.findByText("Connect your Gmail account first")).toBeTruthy();
    fillTo();
    expect(sendButton().disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
  });
});

describe("the sliding effect", () => {
  it("slides in from the right with the page dimming behind it, and slides back out before it is removed", async () => {
    stubApi(base);
    let exited = 0;
    let setOpen!: (v: boolean) => void;
    function Host() {
      const [o, set] = useState(true);
      setOpen = set;
      return <JobApplyPanel job={job} open={o} onClose={() => set(false)} onExited={() => { exited++; }} />;
    }
    renderAt(<Host />);
    const p = panel();
    expect(p.className).toContain("slide-in-right");
    expect(p.className).not.toContain("slide-out-right");
    expect((p.previousElementSibling as HTMLElement).className).toContain("fade-in");

    // Closing (the X, Escape or a click on the dimmed page): the same panel plays its exit and is hidden from assistive technology, then it goes.
    act(() => setOpen(false));
    expect(screen.queryByRole("dialog", { name: "Apply by email" })).toBeNull();
    const leaving = document.querySelector("aside[role=dialog]") as HTMLElement;
    expect(leaving.className).toContain("slide-out-right");
    expect((leaving.previousElementSibling as HTMLElement).className).toContain("fade-out");
    expect(exited).toBe(0);
    await waitFor(() => expect(document.querySelector("aside[role=dialog]")).toBeNull(), { timeout: 1500 });
    expect(exited).toBe(1);
  });

  it("keeps the slide for people whose system asks for less motion (just quicker), instead of switching it off", async () => {
    const css = (await import("node:fs")).readFileSync("src/client/index.css", "utf8");
    expect(css).toMatch(/\.slide-in-right \{ animation: slide-in-right var\(--slide-ms\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ :root \{ --slide-ms: 160ms/);
    expect(css).not.toMatch(/prefers-reduced-motion[^}]*\{[^}]*animation: none/);
  });
});

describe("attachments in the Apply panel", () => {
  it("accepts only PDF and Word files in the picker, and says so", () => {
    open();
    const input = screen.getByLabelText("Attach files") as HTMLInputElement;
    expect(input.accept).toBe(ATTACHMENT_ACCEPT);
    for (const want of [".pdf", ".doc", ".docx", "application/pdf", "application/msword"]) expect(input.accept).toContain(want);
    expect(input.accept).not.toMatch(/\.exe|image|\.txt|\.zip/);
    expect(input.multiple).toBe(true);
    expect(screen.getByText(/PDF or Word files only/)).toBeTruthy();
  });

  it("lists the chosen files with their size, and removes one on request", () => {
    open();
    attach(file("resume.pdf", 2048), file("letter.doc", 500));
    const list = screen.getByRole("list", { name: "Attached files" });
    expect(within(list).getByText(/resume\.pdf/)).toBeTruthy();
    expect(within(list).getByText(/\(2 KB\)/)).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "Remove resume.pdf" }));
    expect(within(list).queryByText(/resume\.pdf/)).toBeNull();
    expect(within(list).getByText(/letter\.doc/)).toBeTruthy();
  });

  it("refuses other kinds of file at once, with the reason, and keeps the good ones", () => {
    open();
    attach(file("virus.exe"), file("notes.txt"), file("good.pdf"));
    expect(screen.getByRole("alert").textContent).toMatch(/not a PDF or Word document/);
    const list = screen.getByRole("list", { name: "Attached files" });
    expect(within(list).getAllByRole("listitem").filter((li) => /\.(pdf|doc|docx)\b/.test(li.textContent ?? ""))).toHaveLength(1);
    expect(within(list).queryByText(/virus/)).toBeNull();
  });

  it("refuses a fourth file, an empty one, a duplicate, and more than 5 MB in all", () => {
    open();
    attach(file("a.pdf"), file("b.pdf"), file("c.pdf"));
    attach(file("d.pdf"));
    expect(screen.getByRole("alert").textContent).toMatch(/at most 3 files/);
    expect((screen.getByRole("button", { name: "Attach files" }) as HTMLButtonElement).disabled).toBe(true); // the button stops offering more
    fireEvent.click(screen.getByRole("button", { name: "Remove c.pdf" }));
    attach(file("empty.pdf", 0));
    expect(screen.getByRole("alert").textContent).toMatch(/is empty/);
    attach(file("a.pdf"));
    expect(screen.getByRole("alert").textContent).toMatch(/already attached/);
    attach(file("big.pdf", MAX_TOTAL_ATTACHMENT_BYTES));
    expect(screen.getByRole("alert").textContent).toMatch(/at most 5\.0 MB in all/);
  });

  it("is not sent with an attachment that was removed", async () => {
    const calls = open();
    await screen.findByText(/sales@acme.test/);
    fillTo();
    attach(file("one.pdf"), file("two.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Remove one.pdf" }));
    fireEvent.click(sendButton());
    await waitFor(() => expect(sendCall(calls)).toBeTruthy());
    expect(sendCall(calls)!.formData!.getAll("attachments").map((f) => (f as File).name)).toEqual(["two.pdf"]);
  });
});
