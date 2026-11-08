// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider, useRole } from "../../src/client/hooks/useRole";
import type { MeDto } from "../../src/shared/api";
import type { Role } from "../../src/shared/types";
import { stubApi } from "./harness";

const me = (access: Role): MeDto => ({
  user: { id: "u1", email: "a@b.test", firstName: "A", lastName: "B", displayName: "A B", access, mustChangePassword: false },
  tenant: { id: "t", name: "T", slug: "t", postalAddress: "" },
  session: true,
});

function Probe() {
  const r = useRole();
  return <p data-testid="p">{`${r.role}|ready:${r.ready}|edit:${r.canEdit}|admin:${r.isAdmin}`}</p>;
}
const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RoleProvider><Probe /></RoleProvider>
  </QueryClientProvider>,
);
const text = () => screen.getByTestId("p").textContent;

describe("the role comes from the signed-in user", () => {
  it.each([
    ["Administrator", "edit:true|admin:true"],
    ["Campaign Manager", "edit:true|admin:false"],
    ["Viewer", "edit:false|admin:false"],
  ] as const)("%s", async (access, flags) => {
    stubApi(({ path }) => (path === "/api/me" ? { json: me(access) } : undefined));
    show();
    await waitFor(() => expect(text()).toContain("ready:true"));
    expect(text()).toBe(`${access}|ready:true|${flags}`);
  });

  it("offers nothing until the user is known: read-only and not ready", async () => {
    stubApi(() => new Promise(() => undefined) as never);
    show();
    expect(text()).toBe("Viewer|ready:false|edit:false|admin:false");
  });

  it("stays read-only when the user cannot be loaded (not signed in)", async () => {
    stubApi(() => ({ status: 401, json: { error: { code: "NO_ACTIVE_USER", message: "Not signed in", correlationId: "x" } } }));
    show();
    await new Promise((r) => setTimeout(r, 50));
    expect(text()).toBe("Viewer|ready:false|edit:false|admin:false");
  });
});
