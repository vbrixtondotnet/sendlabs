// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MySettings } from "../../src/client/pages/MySettings";
import type { MeDto } from "../../src/shared/api";
import { renderAt, stubApi, type Call, type Handler } from "./harness";

const meDto = (over: Partial<MeDto["user"]> = {}): MeDto => ({
  user: { id: "u1", role: "Agency", avatarUrl: null, email: "ada@acme.test", firstName: "Ada", lastName: "Lovelace", position: "", displayName: "Ada Lovelace", mustChangePassword: false, credits: 100, ...over },
  company: { name: "Acme", postalAddress: "", website: "", requireUnsubscribeLink: true, oneClickUnsubscribe: true },
  session: true,
});
const fail = (status: number, code: string, message: string, details?: unknown) => ({ status, json: { error: { code, message, details, correlationId: "x" } } });

/** A server that remembers what was saved, like the real one. */
function server(opts: { profileReply?: ReturnType<typeof fail>; passwordReply?: { status: number; json?: unknown } } = {}): Handler {
  let me = meDto();
  return ({ method, path, body }: Call) => {
    if (method === "GET" && path === "/api/me") return { json: me };
    if (method === "PATCH" && path === "/api/me") {
      if (opts.profileReply) return opts.profileReply;
      const displayName = `${body.firstName} ${body.lastName}`;
      me = { ...me, user: { ...me.user, ...body, displayName } };
      return { json: { ...body, displayName } };
    }
    if (method === "POST" && path === "/api/me/password") return opts.passwordReply ?? { status: 204 };
    return undefined;
  };
}
const open = (handler: Handler, path = "/account") => {
  const calls = stubApi(handler);
  renderAt(<MySettings />, { path, route: "/account" });
  return calls;
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const writes = (calls: Call[]) => calls.filter((c) => c.method === "PATCH");

describe("Account Settings: tabs by role", () => {
  const as = (role: "SuperAdmin" | "JobSeeker" | "Agency", path = "/account") =>
    open(({ method, path: p, ...r }) => (p === "/api/me" ? { json: meDto({ role }) } : p === "/api/sender" ? { json: { configured: true, sender: null } } : server()({ method, path: p, ...r } as Call)), path);
  const tabs = () => screen.getAllByRole("tab").map((t) => t.textContent);

  it("is called Account Settings, and Profile is the first tab", async () => {
    open(server());
    expect(await screen.findByRole("heading", { name: "Account Settings" })).toBeTruthy();
    await screen.findByLabelText("First name");
    expect(tabs()[0]).toBe("Profile");
    expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: "User Details" })).toBeNull();
  });

  it("an Agency has Profile, Account Details, Company Details and Email Service", async () => {
    as("Agency");
    await screen.findByLabelText("First name");
    await waitFor(() => expect(tabs()).toEqual(["Profile", "Account Details", "Company Details", "Email Service"]));
  });

  it("a JobSeeker has Profile, Account Details and Email Settings (no Company Details, no Email Service)", async () => {
    as("JobSeeker");
    await screen.findByLabelText("First name");
    await waitFor(() => expect(tabs()).toEqual(["Profile", "Account Details", "Email Settings"]));
    expect(screen.queryByRole("tab", { name: "Company Details" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Email Service" })).toBeNull();
  });

  it("a SuperAdmin has only Profile and Account Details", async () => {
    as("SuperAdmin");
    await screen.findByLabelText("First name");
    expect(tabs()).toEqual(["Profile", "Account Details"]);
  });

  it("shows the Gmail connection on a JobSeeker's Email Settings, without the campaign-only cards", async () => {
    as("JobSeeker");
    await screen.findByLabelText("First name");
    fireEvent.click(await screen.findByRole("tab", { name: "Email Settings" }));
    expect(await screen.findByText("Gmail sender")).toBeTruthy();
    expect(screen.queryByText("Test-send allowlist")).toBeNull();
    expect(screen.queryByText("Suppression list")).toBeNull();
    expect(screen.queryByText("Unsubscribe and compliance")).toBeNull();
  });

  it("opens on the email tab for ?tab=email and when Google sends the browser back (?sender=...); ?tab=company and ?tab=account pick theirs", async () => {
    as("JobSeeker", "/account?tab=email");
    expect((await screen.findByRole("tab", { name: "Email Settings" })).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("Gmail sender")).toBeTruthy();
  });

  it("an Agency's ?tab=company opens Company Details and ?tab=account Account Details; anything else opens Profile", async () => {
    open(server(), "/account?tab=company");
    expect(await screen.findByLabelText("Postal address")).toBeTruthy();
  });

  it("can open straight on Account Details", async () => {
    open(server(), "/account?tab=account");
    expect(await screen.findByLabelText("Current password")).toBeTruthy();
  });

  it("switches between Profile and Account Details", async () => {
    open(server());
    await screen.findByLabelText("First name");
    expect(screen.queryByLabelText("Current password")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Account Details" }));
    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(screen.queryByLabelText("First name")).toBeNull();
  });
});

describe("Profile picture", () => {
  const png = (name = "me.png", type = "image/png", size = 100) => new File([new Uint8Array(size).fill(1)], name, { type });
  const withAvatar = (url: string | null, extra?: Handler): Handler => {
    let current = url;
    return (c) => {
      if (c.method === "GET" && c.path === "/api/me") return { json: meDto({ avatarUrl: current }) };
      if (c.method === "PUT" && c.path === "/api/me/avatar") { current = "/api/me/avatar?v=2"; return { json: { avatarUrl: current } }; }
      if (c.method === "DELETE" && c.path === "/api/me/avatar") { current = null; return { status: 204 }; }
      return extra?.(c) ?? server()(c);
    };
  };
  const pick = (f: File) => fireEvent.change(screen.getByLabelText("Profile picture file"), { target: { files: [f] } });

  it("shows your initials until you upload a picture, and offers Upload picture", async () => {
    open(withAvatar(null));
    await screen.findByLabelText("First name");
    expect(screen.getByTestId("profile-picture").textContent).toBe("AL");
    expect(screen.getByRole("button", { name: "Upload picture" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect((screen.getByLabelText("Profile picture file") as HTMLInputElement).accept).toBe("image/jpeg,image/png,image/webp,image/gif"); // images only
  });

  it("uploads the chosen image as a form, then shows it with Change picture and Remove", async () => {
    const calls = open(withAvatar(null));
    await screen.findByLabelText("First name");
    pick(png());
    await waitFor(() => expect(screen.getByRole("img", { name: "Your profile picture" }).getAttribute("src")).toBe("/api/me/avatar?v=2"));
    const put = calls.find((c) => c.method === "PUT" && c.path === "/api/me/avatar")!;
    expect([...put.formData!.keys()]).toEqual(["file"]);
    expect((put.formData!.get("file") as File).name).toBe("me.png");
    expect(screen.getByRole("button", { name: "Change picture" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("refuses a file that is not an image, or is too big, without sending anything", async () => {
    const calls = open(withAvatar(null));
    await screen.findByLabelText("First name");
    pick(png("notes.txt", "text/plain"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Choose an image file/);
    pick(png("icon.svg", "image/svg+xml"));
    expect(screen.getByRole("alert").textContent).toMatch(/Choose an image file/);
    pick(png("huge.png", "image/png", 3 * 1024 * 1024));
    expect(screen.getByRole("alert").textContent).toMatch(/at most 2 MB/);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("removes the picture and goes back to the initials", async () => {
    const calls = open(withAvatar("/api/me/avatar?v=1"));
    await screen.findByLabelText("First name");
    expect(screen.getByRole("img", { name: "Your profile picture" }).getAttribute("src")).toBe("/api/me/avatar?v=1");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "Your profile picture" })).toBeNull());
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/me/avatar")).toBe(true);
    expect(screen.getByTestId("profile-picture").textContent).toBe("AL");
  });
});

describe("User Details tab", () => {
  const openUser = (handler: Handler = server()) => open(handler, "/account");

  it("shows the current first and last name, and the email read-only", async () => {
    openUser();
    await screen.findByLabelText("First name");
    expect(input("First name").value).toBe("Ada");
    expect(input("Last name").value).toBe("Lovelace");
    expect(input("Email address").value).toBe("ada@acme.test");
    expect(input("Email address").readOnly).toBe(true);
  });

  it("has a Position field, empty until it is set, and an optional one", async () => {
    openUser();
    await screen.findByLabelText("Job Title");
    expect(input("Job Title").value).toBe("");
    expect(input("Job Title").readOnly).toBe(false);
    expect(input("Job Title").disabled).toBe(false);
    expect(input("Job Title").maxLength).toBe(100);
    expect(screen.getByText(/Optional/)).toBeTruthy();
  });

  it("shows the saved position", async () => {
    openUser(() => ({ json: meDto({ position: "Sales Director" }) }));
    await screen.findByLabelText("Job Title");
    expect(input("Job Title").value).toBe("Sales Director");
  });

  it("saves a changed position on its own, and it counts as a change", async () => {
    const calls = openUser();
    await screen.findByLabelText("Job Title");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    type("Job Title", "  Head of Sales ");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Profile updated")).toBeTruthy();
    expect(writes(calls)[0]!.body).toEqual({ firstName: "Ada", lastName: "Lovelace", position: "Head of Sales" });
    expect(input("Job Title").value).toBe("Head of Sales");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true); // saved: nothing left to save
  });

  it("can be cleared again, and is allowed to be empty", async () => {
    const calls = openUser((c) => (c.method === "GET" ? { json: meDto({ position: "CTO" }) } : { json: { firstName: "Ada", lastName: "Lovelace", position: "", displayName: "Ada Lovelace" } }));
    await screen.findByLabelText("Job Title");
    type("Job Title", "");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body.position).toBe("");
  });

  it("shows the server's reason under the field, and keeps what was typed", async () => {
    openUser(server({ profileReply: fail(400, "VALIDATION_ERROR", "Validation failed", [{ path: "position", message: "Use at most 100 characters" }]) }));
    await screen.findByLabelText("Job Title");
    type("Job Title", "something");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Use at most 100 characters")).toBeTruthy();
    expect(input("Job Title").value).toBe("something");
  });

  it("no longer carries the organization name", async () => {
    openUser(server());
    await screen.findByLabelText("First name");
    expect(screen.queryByLabelText("Organization name")).toBeNull();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("cannot be saved until something changed, and not with an empty name", async () => {
    openUser();
    await screen.findByLabelText("First name");
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    type("First name", "Grace");
    expect(save.disabled).toBe(false);
    type("Last name", "  ");
    expect(save.disabled).toBe(true);
    type("Last name", "Lovelace");
    type("First name", "Ada");
    expect(save.disabled).toBe(true);
  });

  it("saves the new name, sending the names and position only, and never touches the company", async () => {
    const calls = openUser(server());
    await screen.findByLabelText("First name");
    type("First name", " Grace ");
    type("Last name", "Hopper");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Profile updated")).toBeTruthy();
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]!.path).toBe("/api/me");
    expect(writes(calls)[0]!.body).toEqual({ firstName: "Grace", lastName: "Hopper", position: "" });
    expect(input("First name").value).toBe("Grace");
  });

  it("shows what the server said when it refuses, and keeps what was typed", async () => {
    openUser(server({ profileReply: fail(400, "VALIDATION_ERROR", "Validation failed", [{ path: "firstName", message: "First name is required" }]) }));
    await screen.findByLabelText("First name");
    type("First name", "Grace");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("First name is required")).toBeTruthy();
    expect(input("First name").value).toBe("Grace");
  });

  it("shows an unexpected failure plainly", async () => {
    openUser(server({ profileReply: fail(500, "INTERNAL", "Something went wrong on our side") }));
    await screen.findByLabelText("First name");
    type("First name", "Grace");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Something went wrong on our side")).toBeTruthy();
  });
});

describe("Account Details tab", () => {
  const openAccount = (handler: Handler = server()) => open(handler, "/account?tab=account");
  const fill = (current = "old-password-1", next = "new-password-2", confirm = next) => {
    type("Current password", current);
    type("New password", next);
    type("Confirm new password", confirm);
  };
  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Change password" }));

  it("asks for the current password, the new one, and the new one again, all hidden", async () => {
    openAccount();
    await screen.findByLabelText("Current password");
    for (const l of ["Current password", "New password", "Confirm new password"]) expect(input(l).type).toBe("password");
    expect((screen.getByRole("button", { name: "Change password" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("changes the password, sends only the two passwords, and clears the form", async () => {
    const calls = openAccount();
    await screen.findByLabelText("Current password");
    fill();
    submit();
    expect(await screen.findByText("Password changed. Your other devices were signed out.")).toBeTruthy();
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe("/api/me/password");
    expect(post.body).toEqual({ currentPassword: "old-password-1", newPassword: "new-password-2" });
    for (const l of ["Current password", "New password", "Confirm new password"]) expect(input(l).value).toBe("");
  });

  it("will not send a short password, a mismatch, or the same password again, and says why", async () => {
    const calls = openAccount();
    await screen.findByLabelText("Current password");
    fill("old-password-1", "short");
    submit();
    expect(await screen.findByText("Use at least 8 characters")).toBeTruthy();
    fill("old-password-1", "new-password-2", "different-3");
    submit();
    expect(await screen.findByText("The passwords do not match.")).toBeTruthy();
    fill("old-password-1", "old-password-1");
    submit();
    expect(await screen.findByText("Choose a password different from your current one")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("tells you when the current password is wrong, under that field, and clears it", async () => {
    openAccount(server({ passwordReply: fail(400, "INVALID_CURRENT_PASSWORD", "Your current password is not correct", [{ path: "currentPassword", message: "Your current password is not correct" }]) }));
    await screen.findByLabelText("Current password");
    fill();
    submit();
    expect(await screen.findByText("Your current password is not correct")).toBeTruthy();
    expect(input("Current password").value).toBe("");
    expect(input("New password").value).toBe("new-password-2");
  });

  it("says how long to wait when locked", async () => {
    openAccount(server({ passwordReply: fail(429, "TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Try again in 15 minute(s).") }));
    await screen.findByLabelText("Current password");
    fill();
    submit();
    expect(await screen.findByText("Too many incorrect attempts. Try again in 15 minute(s).")).toBeTruthy();
  });

  it("does not submit twice while changing", async () => {
    const calls = openAccount();
    await screen.findByLabelText("Current password");
    fill();
    const form = screen.getByLabelText("Current password").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await screen.findByText("Password changed. Your other devices were signed out.");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
});

describe("loading and failure", () => {
  it("shows an error, not an empty form, when the user cannot be loaded", async () => {
    open(() => fail(500, "INTERNAL", "Something went wrong on our side"));
    expect(await screen.findByText("Something went wrong on our side")).toBeTruthy();
    expect(screen.queryByLabelText("Postal address")).toBeNull();
  });
});
