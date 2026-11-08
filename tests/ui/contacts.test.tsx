// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Contacts } from "../../src/client/pages/Contacts";
import { contact, page, renderAt, stubApi, type Handler } from "./harness";

const julie = contact({ id: "c2", email: "julie@jcdavispower.com", firstName: "Julie", lastName: "Richardson", companyName: "JC Davis Power", industry: "construction", consentStatus: "Granted" });

const base: Handler = ({ method, path }) => {
  if (path === "/api/contacts/industries") return { json: { items: ["construction", "retail"] } };
  if (path === "/api/contacts" && method === "GET") return { json: page([contact(), julie]) };
  return undefined;
};

const lastList = (calls: ReturnType<typeof stubApi>) => [...calls].reverse().find((c) => c.path === "/api/contacts" && c.method === "GET");

describe("Contacts page (live data)", () => {
  it("loads and shows contacts from the API", async () => {
    stubApi(base);
    renderAt(<Contacts />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    expect(await screen.findByText("Nick Harbaugh")).toBeTruthy();
    expect(screen.getByText("julie@jcdavispower.com")).toBeTruthy();
    expect(screen.getByText("2 contacts match.", { exact: false })).toBeTruthy();
    const julieRow = screen.getByText("julie@jcdavispower.com").closest("tr")!;
    expect(within(julieRow).getByText("Granted")).toBeTruthy(); // the badge, not the filter option
  });

  it("sends the search text (debounced), the industry and the consent filter to the API", async () => {
    const calls = stubApi(base);
    renderAt(<Contacts />);
    await screen.findByText("Nick Harbaugh");
    expect(lastList(calls)!.query.get("page")).toBe("1");
    expect(lastList(calls)!.query.get("pageSize")).toBe("15");

    fireEvent.change(screen.getByLabelText("Search contacts"), { target: { value: "julie" } });
    await waitFor(() => expect(lastList(calls)!.query.get("q")).toBe("julie"), { timeout: 3000 });

    await screen.findByRole("option", { name: "construction" }); // industries come from the API
    fireEvent.change(screen.getByLabelText("Filter by industry"), { target: { value: "construction" } });
    await waitFor(() => expect(lastList(calls)!.query.get("industry")).toBe("construction"));

    fireEvent.change(screen.getByLabelText("Filter by consent"), { target: { value: "Granted" } });
    await waitFor(() => expect(lastList(calls)!.query.get("consent")).toBe("Granted"));
    expect(lastList(calls)!.query.get("page")).toBe("1"); // filters reset to the first page
  });

  it("pages through results", async () => {
    const calls = stubApi(({ method, path, query }) => {
      if (path === "/api/contacts/industries") return { json: { items: [] } };
      if (path === "/api/contacts" && method === "GET") return { json: page([contact({ id: `p${query.get("page")}` })], 40, Number(query.get("page"))) };
      return undefined;
    });
    renderAt(<Contacts />);
    await screen.findByText("Nick Harbaugh");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastList(calls)!.query.get("page")).toBe("2"));
    expect(screen.getByText("Page 2 / 3")).toBeTruthy();
  });

  it("explains an empty database, and empty search results", async () => {
    stubApi(({ method, path }) => (path === "/api/contacts/industries" ? { json: { items: [] } } : path === "/api/contacts" && method === "GET" ? { json: page([]) } : undefined));
    renderAt(<Contacts />);
    expect(await screen.findByText(/No contacts yet/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search contacts"), { target: { value: "zzz" } });
    expect(await screen.findByText("No contacts match your filters.", {}, { timeout: 3000 })).toBeTruthy();
  });

  it("shows a server refusal with its reference, and offers a retry", async () => {
    stubApi(({ path }) =>
      path === "/api/contacts" ? { status: 503, json: { error: { code: "AUTH_NOT_CONFIGURED", message: "nope", correlationId: "ref-123" } } } : { json: { items: [] } },
    );
    renderAt(<Contacts />);
    expect(await screen.findByText(/authentication is not configured/i)).toBeTruthy();
    expect(screen.getByText("Reference: ref-123")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("tells you when the API is not running", async () => {
    stubApi(() => { throw new Error("connection refused"); });
    renderAt(<Contacts />);
    expect(await screen.findByText(/npm run dev:api/)).toBeTruthy();
  });

  describe("add, edit, delete", () => {
    it("creates a contact and refreshes the list", async () => {
      const calls = stubApi((c) => (c.method === "POST" && c.path === "/api/contacts" ? { status: 201, json: contact({ id: "new" }) } : base(c)));
      renderAt(<Contacts />);
      await screen.findByText("Nick Harbaugh");
      const before = calls.filter((c) => c.path === "/api/contacts" && c.method === "GET").length;

      fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
      const dialog = await screen.findByRole("dialog", { name: "Add contact" });
      fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "New@Example.com" } });
      fireEvent.change(within(dialog).getByLabelText("First name"), { target: { value: "New" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Add contact" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const post = calls.find((c) => c.method === "POST")!;
      expect(post.body).toMatchObject({ email: "New@Example.com", firstName: "New", employees: null, annualRevenue: null, consentStatus: "Unknown" });
      await waitFor(() => expect(calls.filter((c) => c.path === "/api/contacts" && c.method === "GET").length).toBeGreaterThan(before));
    });

    it("keeps the dialog open and explains a duplicate email", async () => {
      stubApi((c) => (c.method === "POST" ? { status: 409, json: { error: { code: "EMAIL_EXISTS", message: "A contact with this email address already exists", correlationId: "x" } } } : base(c)));
      renderAt(<Contacts />);
      await screen.findByText("Nick Harbaugh");
      fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "dup@example.com" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Add contact" }));
      expect(await within(dialog).findByText("That email already exists")).toBeTruthy();
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("shows field-level validation errors next to the field", async () => {
      stubApi((c) =>
        c.method === "POST"
          ? { status: 400, json: { error: { code: "VALIDATION_ERROR", message: "Validation failed", details: [{ path: "website", message: "Must be an http(s) URL or empty" }], correlationId: "x" } } }
          : base(c),
      );
      renderAt(<Contacts />);
      await screen.findByText("Nick Harbaugh");
      fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "a@b.co" } });
      fireEvent.change(within(dialog).getByLabelText("Website"), { target: { value: "javascript:alert(1)" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Add contact" }));
      // appears both inline and in the summary list
      expect((await within(dialog).findAllByText(/Must be an http\(s\) URL or empty/)).length).toBeGreaterThanOrEqual(2);
    });

    it("edits an existing contact with a PATCH", async () => {
      const calls = stubApi((c) => (c.method === "PATCH" ? { json: contact({ title: "CEO" }) } : base(c)));
      renderAt(<Contacts />);
      fireEvent.click(await screen.findByRole("button", { name: "Nick Harbaugh" }));
      const dialog = await screen.findByRole("dialog", { name: "Contact details" });
      expect((within(dialog).getByLabelText("Email") as HTMLInputElement).value).toBe("nick@flexecutioninc.com");
      fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "CEO" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const patch = calls.find((c) => c.method === "PATCH")!;
      expect(patch.path).toBe("/api/contacts/c1");
      expect(patch.body).toMatchObject({ title: "CEO", employees: 53, annualRevenue: 16175000 });
    });

    it("asks before deleting, then deletes", async () => {
      const calls = stubApi((c) => (c.method === "DELETE" ? { status: 204 } : base(c)));
      renderAt(<Contacts />);
      fireEvent.click(await screen.findByRole("button", { name: "Nick Harbaugh" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
      expect(calls.some((c) => c.method === "DELETE")).toBe(false); // not yet
      expect(within(dialog).getByText(/Past campaigns keep their records/)).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete contact" }));
      await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/contacts/c1")).toBe(true));
    });

    it("is read-only for a Viewer", async () => {
      stubApi(base);
      renderAt(<Contacts />, { role: "Viewer" });
      await screen.findByText("Nick Harbaugh");
      expect(screen.queryByRole("button", { name: "Add contact" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Nick Harbaugh" }));
      const dialog = await screen.findByRole("dialog");
      expect((within(dialog).getByLabelText("Title") as HTMLInputElement).disabled).toBe(true);
      expect(within(dialog).queryByRole("button", { name: "Save changes" })).toBeNull();
      expect(within(dialog).queryByRole("button", { name: "Delete" })).toBeNull();
    });
  });
});
