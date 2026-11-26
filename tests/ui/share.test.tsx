// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ShareJob } from "../../src/client/components/ShareJob";
import { SharedJob } from "../../src/client/pages/SharedJob";
import type { JobDto } from "../../src/shared/api";
import { meDto, renderAt, senderStatus, stubApi, type Call, type Handler } from "./harness";

const job: JobDto = {
  id: "remotive:1", title: "Senior .NET Developer", companyName: "Acme Corp", companyLogo: "https://remotive.com/job/1/logo", category: "Software Development", employmentType: "Full-time",
  remote: true, location: "Worldwide", salary: "$3,000", skills: ["c#", "azure"], url: "https://remotive.com/remote-jobs/software-dev/job-1", source: "Remotive", publishedAt: new Date().toISOString(),
};
const started = (over: Record<string, unknown> = {}) => ({ json: { shareId: "sh1", url: "http://localhost:5173/share/sh1", network: "linkedin", alreadyRewarded: false, confirmAfterMs: 0, ...over } });

/** A stand-in for the share window the click opens. */
const fakeWindow = () => {
  const win = { location: { href: "" }, close: vi.fn() };
  const open = vi.fn(() => win);
  vi.stubGlobal("open", open);
  return { win, open };
};
afterEach(() => vi.unstubAllGlobals());

describe("Share this job (on every job card)", () => {
  const api = (over: Handler = () => undefined): Handler => (c) => over(c) ?? (c.path === "/api/me" ? { json: meDto() } : undefined);

  it("says Share this job and earn 1 Credit, with a LinkedIn and a Facebook button", () => {
    stubApi(api());
    renderAt(<ShareJob job={job} />);
    expect(screen.getByText("Share this job and earn 1 Credit")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share on LinkedIn" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share on Facebook" })).toBeTruthy();
  });

  it("opens the network's share window with the public link, then asks 'Posted it on LinkedIn?'", async () => {
    const calls = stubApi(api((c) => (c.path === "/api/jobs/share" ? started() : undefined)));
    const { win } = fakeWindow();
    renderAt(<ShareJob job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share on LinkedIn" }));
    expect(await screen.findByText("Posted it on LinkedIn?")).toBeTruthy();
    expect(calls.find((c) => c.path === "/api/jobs/share")!.body).toEqual({ jobId: "remotive:1", title: "Senior .NET Developer", network: "linkedin" });
    expect(win.location.href).toBe("https://www.linkedin.com/sharing/share-offsite/?url=http%3A%2F%2Flocalhost%3A5173%2Fshare%2Fsh1");
  });

  it("uses Facebook's share window for Facebook", async () => {
    stubApi(api((c) => (c.path === "/api/jobs/share" ? started({ network: "facebook" }) : undefined)));
    const { win } = fakeWindow();
    renderAt(<ShareJob job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share on Facebook" }));
    expect(await screen.findByText("Posted it on Facebook?")).toBeTruthy();
    expect(win.location.href).toBe("https://www.facebook.com/sharer/sharer.php?u=http%3A%2F%2Flocalhost%3A5173%2Fshare%2Fsh1");
  });

  it("gives the credit only when the person says they posted it, and says thank you", async () => {
    const calls = stubApi(api((c) => (c.path === "/api/jobs/share" ? started() : c.path === "/api/jobs/share/sh1/confirm" ? { json: { rewarded: true, credits: 101 } } : undefined)));
    fakeWindow();
    renderAt(<ShareJob job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share on LinkedIn" }));
    await screen.findByText("Posted it on LinkedIn?");
    expect(calls.some((c) => c.path.endsWith("/confirm"))).toBe(false); // nothing is claimed just by opening the window
    fireEvent.click(screen.getByRole("button", { name: "I've posted it" }));
    expect(await screen.findByText(/Thank you for sharing! 1 Credit has been added/)).toBeTruthy();
    expect(calls.filter((c) => c.path.endsWith("/confirm"))).toHaveLength(1);
    expect(screen.getByText("Share this job and earn 1 Credit")).toBeTruthy(); // back to the buttons
  });

  it("keeps I've posted it switched off until there has been time to write the post", async () => {
    stubApi(api((c) => (c.path === "/api/jobs/share" ? started({ confirmAfterMs: 60_000 }) : undefined)));
    fakeWindow();
    renderAt(<ShareJob job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share on LinkedIn" }));
    const wait = await screen.findByRole("button", { name: /I've posted it \(\d+s\)/ });
    expect((wait as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows why when the credit is refused (for example the daily limit)", async () => {
    stubApi(api((c) => (c.path === "/api/jobs/share" ? started() : c.path.endsWith("/confirm") ? { status: 429, json: { error: { code: "SHARE_DAILY_LIMIT", message: "You have earned the most share credits for today (5). Try again tomorrow." } } } : undefined)));
    fakeWindow();
    renderAt(<ShareJob job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share on LinkedIn" }));
    await screen.findByText("Posted it on LinkedIn?");
    fireEvent.click(screen.getByRole("button", { name: "I've posted it" }));
    expect(await screen.findByText(/earned the most share credits for today/)).toBeTruthy();
  });

  it("says so, and asks nothing more, when this job was already shared to that network", async () => {
    stubApi(api((c) => (c.path === "/api/jobs/share" ? started({ alreadyRewarded: true }) : undefined)));
    fakeWindow();
    renderAt(<ShareJob job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share on LinkedIn" }));
    expect(await screen.findByText(/already earned the credit for this job on LinkedIn/)).toBeTruthy();
    expect(screen.queryByText("Posted it on LinkedIn?")).toBeNull();
  });

  it("closes the window and shows the reason when the job cannot be shared", async () => {
    stubApi(api((c) => (c.path === "/api/jobs/share" ? { status: 404, json: { error: { code: "NOT_FOUND", message: "This job is no longer listed, so it cannot be shared" } } } : undefined)));
    const { win } = fakeWindow();
    renderAt(<ShareJob job={job} />);
    fireEvent.click(screen.getByRole("button", { name: "Share on LinkedIn" }));
    expect(await screen.findByText(/no longer listed/)).toBeTruthy();
    expect(win.close).toHaveBeenCalled();
  });
});

describe("the public job page /share/:id", () => {
  const data = { job, blocks: [{ type: "heading", text: "About the role" }, { type: "paragraph", text: "You will build great things." }] };
  const site = (extra: Handler = () => undefined): Handler => (c: Call) =>
    extra(c) ?? (c.path === "/api/share/sh1" ? { json: data } : c.path === "/api/share/nope" ? { status: 404, json: { error: { code: "NOT_FOUND", message: "Shared job not found" } } } : c.path === "/api/sender" ? { json: senderStatus() } : undefined);
  const visit = (id = "sh1") => renderAt(<SharedJob />, { path: `/share/${id}`, route: "/share/:id" });
  const signedOut: Handler = (c) => (c.path === "/api/me" ? { status: 401, json: { error: { code: "UNAUTHENTICATED", message: "Sign in" } } } : undefined);

  it("shows the job as the View Job panel does: logo, title, company, facts and description, with Apply Now", async () => {
    stubApi(site(signedOut));
    visit();
    expect(await screen.findByRole("heading", { name: "Senior .NET Developer" })).toBeTruthy();
    expect(screen.getByText("Acme Corp")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Acme Corp logo" }).getAttribute("src")).toBe("https://remotive.com/job/1/logo");
    expect(screen.getByText("Remote · Full-time · $3,000")).toBeTruthy();
    expect(screen.getByText("c# · azure")).toBeTruthy();
    expect(screen.getByText("You will build great things.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply now: Senior .NET Developer" })).toBeTruthy();
  });

  it("for a visitor, Apply Now is only displayed: it opens nothing yet (sign-up is not built)", async () => {
    stubApi(site(signedOut));
    visit();
    fireEvent.click(await screen.findByRole("button", { name: "Apply now: Senior .NET Developer" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("for a signed-in JobSeeker, Apply Now opens the Apply By Email panel", async () => {
    stubApi(site((c) => (c.path === "/api/me" ? { json: meDto({ role: "JobSeeker" }) } : undefined)));
    visit();
    fireEvent.click(await screen.findByRole("button", { name: "Apply now: Senior .NET Developer" }));
    expect(await screen.findByRole("dialog", { name: "Apply By Email" })).toBeTruthy();
  });

  it("says the link is not valid for an unknown share", async () => {
    stubApi(site(signedOut));
    visit("nope");
    expect(await screen.findByText("This job link is not valid")).toBeTruthy();
  });

  it("shows no menu or account details: it is outside the app", async () => {
    stubApi(site(signedOut));
    visit();
    await screen.findByRole("heading", { name: "Senior .NET Developer" });
    expect(screen.queryByRole("navigation")).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("user-icon")).toBeNull());
  });
});
