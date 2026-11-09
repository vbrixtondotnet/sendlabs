// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Unsubscribe } from "../../src/client/pages/Unsubscribe";
import type { UnsubscribeInfoDto } from "../../src/shared/api";
import { renderAt, stubApi, type Call, type Handler } from "./harness";

const TOKEN = "payload.signature";
const info = (over: Partial<UnsubscribeInfoDto> = {}): UnsubscribeInfoDto => ({ companyName: "Sabertooth Software Labs", email: "a***@example.test", alreadyUnsubscribed: false, test: false, ...over });
const fail = (status: number, code: string, message: string) => ({ status, json: { error: { code, message, correlationId: "x" } } });

/** A server that remembers whether the address was unsubscribed, like the real one. */
function server(opts: { info?: Partial<UnsubscribeInfoDto>; getReply?: ReturnType<typeof fail>; postReply?: ReturnType<typeof fail> } = {}): Handler {
  let done = false;
  return ({ method, path }: Call) => {
    if (path !== `/api/unsubscribe/${TOKEN}`) return undefined;
    if (method === "GET") return opts.getReply ?? { json: info({ ...opts.info, alreadyUnsubscribed: opts.info?.alreadyUnsubscribed ?? done }) };
    if (method === "POST") {
      if (opts.postReply) return opts.postReply;
      done = true;
      return { json: { unsubscribed: !opts.info?.test, test: !!opts.info?.test, companyName: "Sabertooth Software Labs" } };
    }
    return undefined;
  };
}
const open = (handler: Handler) => {
  const calls = stubApi(handler);
  renderAt(<Unsubscribe />, { path: `/unsubscribe/${TOKEN}`, route: "/unsubscribe/:token" });
  return calls;
};
const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

describe("the public unsubscribe page", () => {
  it("asks first, naming the company and the masked address, and changes nothing by being opened", async () => {
    const calls = open(server());
    expect(await screen.findByRole("heading", { name: "Unsubscribe from Sabertooth Software Labs?" })).toBeTruthy();
    expect(screen.getByText("a***@example.test")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unsubscribe" })).toBeTruthy();
    expect(posts(calls)).toHaveLength(0); // a mail scanner opening the link unsubscribes nobody
  });

  it("unsubscribes only when the button is pressed, once, and then confirms", async () => {
    const calls = open(server());
    fireEvent.click(await screen.findByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByRole("heading", { name: "You have been unsubscribed" })).toBeTruthy();
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0]!.path).toBe(`/api/unsubscribe/${TOKEN}`);
    expect(screen.getByText(/will not receive any more emails from Sabertooth Software Labs/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull(); // nothing left to press
  });

  it("cannot be pressed twice while it is working", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const calls = open(server());
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      if (init?.method === "POST") await gate;
      return original(input, init);
    }) as typeof fetch;
    const button = (await screen.findByRole("button", { name: "Unsubscribe" })) as HTMLButtonElement;
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Unsubscribing…" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Unsubscribing…" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribing…" }));
    release();
    await screen.findByRole("heading", { name: "You have been unsubscribed" });
    expect(posts(calls)).toHaveLength(1);
  });

  it("says so, with nothing to press, when the address is already unsubscribed", async () => {
    open(server({ info: { alreadyUnsubscribed: true } }));
    expect(await screen.findByRole("heading", { name: "You are already unsubscribed" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
  });

  it("for a link from a test email: says it is a test, and offers nothing to press", async () => {
    const calls = open(server({ info: { test: true } }));
    expect(await screen.findByRole("heading", { name: "This is a test email" })).toBeTruthy();
    expect(screen.getByText(/Nothing was changed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
    expect(posts(calls)).toHaveLength(0);
  });

  it("says the link is not valid, without saying why, when the server does not recognise it", async () => {
    open(server({ getReply: fail(404, "UNSUBSCRIBE_INVALID", "This unsubscribe link is not valid") }));
    expect(await screen.findByRole("heading", { name: "This unsubscribe link is not valid" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
    expect(screen.queryByText(/Sabertooth/)).toBeNull();
  });

  it("says something went wrong, and offers no button, for any other failure to open the page", async () => {
    open(server({ getReply: fail(503, "UNSUBSCRIBE_NOT_CONFIGURED", "Unsubscribe links are not set up on this server yet") }));
    expect(await screen.findByRole("heading", { name: "We could not open this page" })).toBeTruthy();
    expect(screen.getByText(/not set up on this server yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
  });

  it("shows why pressing the button failed, and lets the person try again", async () => {
    open(server({ postReply: fail(500, "INTERNAL_ERROR", "Something went wrong") }));
    fireEvent.click(await screen.findByRole("button", { name: "Unsubscribe" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong");
    await waitFor(() => expect((screen.getByRole("button", { name: "Unsubscribe" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("heading", { name: "You have been unsubscribed" })).toBeNull();
  });

  it("is a standalone page: it never asks who you are or shows the app's navigation", async () => {
    const calls = open(server());
    await screen.findByRole("heading", { name: /Unsubscribe from/ });
    expect(calls.some((c) => c.path === "/api/me")).toBe(false);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByAltText("Sendrix")).toBeTruthy();
  });
});
