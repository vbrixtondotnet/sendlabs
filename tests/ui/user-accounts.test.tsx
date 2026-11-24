// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { UserAccounts } from "../../src/client/pages/UserAccounts";
import type { UserAccountDto } from "../../src/shared/api";
import { meDto, renderAt, stubApi, type Call } from "./harness";

const T = "2026-11-01T10:00:00.000Z";
const acct = (over: Partial<UserAccountDto>): UserAccountDto => ({
  id: "u1", email: "superadmin@sendrix.app", firstName: "", lastName: "", displayName: "Super Admin", role: "SuperAdmin", status: "Active", mustChangePassword: false, lastLoginAt: null, createdAt: T, ...over,
});
const ACCOUNTS = [
  acct({}),
  acct({ id: "u2", email: "jobseeker@sendrix.app", displayName: "Job Seeker", role: "JobSeeker" }),
  acct({ id: "u3", email: "agency@jobseeker.app", displayName: "Agency", role: "Agency", lastLoginAt: T }),
];

const server = (calls: Call[] = []) => (c: Call) => {
  calls.push(c);
  if (c.path === "/api/me") return { json: meDto({ id: "u1", role: "SuperAdmin" }) };
  if (c.method === "GET" && c.path === "/api/users") return { json: { items: ACCOUNTS } };
  if (c.method === "POST" && c.path === "/api/users") return { status: 201, json: acct({ id: "u9", email: c.body.email, role: c.body.role }) };
  if (c.method === "PATCH" && c.path.startsWith("/api/users/")) return { json: acct({ id: c.path.split("/").pop()!, status: c.body.status ?? "Active" }) };
  return undefined;
};

describe("User Accounts", () => {
  it("lists every account with its role and status", async () => {
    stubApi(server());
    renderAt(<UserAccounts />);
    expect(await screen.findByText("jobseeker@sendrix.app")).toBeTruthy();
    expect(screen.getByText("agency@jobseeker.app")).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Account", "Role", "Status", "Last sign-in", "Actions"]);
    expect(screen.getByText("JobSeeker", { selector: "td" })).toBeTruthy();
  });

  it("adds an account with a role and a temporary password", async () => {
    const calls: Call[] = [];
    stubApi(server(calls));
    renderAt(<UserAccounts />);
    await screen.findByText("jobseeker@sendrix.app");
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "new@example.test" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Agency" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password@123" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add account" }).at(-1)!);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/users")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({ email: "new@example.test", role: "Agency", password: "Password@123" });
  });

  it("cannot change your own role", async () => {
    stubApi(server());
    renderAt(<UserAccounts />);
    await screen.findByText("jobseeker@sendrix.app");
    fireEvent.click(screen.getByRole("button", { name: "Actions for superadmin@sendrix.app" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit/ }));
    expect((await screen.findByLabelText("Role") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
  });
});
