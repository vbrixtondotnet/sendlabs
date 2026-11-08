import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, uniqueEmail, type Caller, type Harness } from "./harness";
import { bigCsv, upload } from "./harness-upload";

/**
 * Two tenants share ONE database. These tests prove that nothing crosses between them: not through the
 * API, and not even through direct SQL, because the foreign keys include tenant_id.
 */
let h: Harness;
let a: Caller; // Sabertooth Software Labs (the harness default)
let b: Caller; // Globex Corp
let B: { tenantId: string; userId: string };
const bEmail = "admin@globex.test";

beforeAll(async () => {
  h = await startHarness();
  a = h;
  B = await h.addTenant("Globex Corp", bEmail);
  b = h.as(bEmail);
});
afterAll(async () => { await h.dispose(); });

const contact = (who: Caller, over: Record<string, unknown> = {}) => who.api("POST", "/api/contacts", { email: uniqueEmail(), ...over });
const campaign = (who: Caller, over: Record<string, unknown> = {}) => who.api("POST", "/api/campaigns", { name: "C", subject: "s", htmlBody: "<p>b</p>", ...over });

describe("who you are decides which tenant you reach", () => {
  it("answers /api/me with your own user and tenant", async () => {
    const ra = await a.api("GET", "/api/me");
    expect(ra.status).toBe(200);
    expect(ra.json).toMatchObject({
      user: { email: h.adminEmail, access: "Administrator", mustChangePassword: false },
      tenant: { id: h.tenantId, name: "Sabertooth Software Labs", slug: "sabertooth-software-labs" },
    });
    const rb = await b.api("GET", "/api/me");
    expect(rb.json).toMatchObject({ user: { email: bEmail }, tenant: { id: B.tenantId, name: "Globex Corp", slug: "globex-corp" } });
  });

  it("never exposes a password hash through the API", async () => {
    // (the flag `mustChangePassword` is fine to show; the hash and its field are not)
    const text = JSON.stringify((await a.api("GET", "/api/me")).json);
    expect(text).not.toMatch(/pbkdf2|passwordHash|password_hash|\$[A-Za-z0-9+/=]{20,}/);
    for (const path of ["/api/contacts", "/api/campaigns", "/api/imports"]) {
      expect(JSON.stringify((await a.api("GET", path)).json)).not.toMatch(/pbkdf2|passwordHash/);
    }
  });

  it("rejects an unknown user, a disabled user and a suspended tenant", async () => {
    const ghost = await h.as("nobody@nowhere.test").api("GET", "/api/contacts");
    expect(ghost.status).toBe(401);
    expect(ghost.json.error.code).toBe("NO_ACTIVE_USER");

    await h.sql("UPDATE users SET status = 'Disabled' WHERE id = ?", B.userId);
    const disabled = await b.api("GET", "/api/contacts");
    expect(disabled.status).toBe(403);
    expect(disabled.json.error.code).toBe("USER_DISABLED");
    await h.sql("UPDATE users SET status = 'Active' WHERE id = ?", B.userId);

    await h.sql("UPDATE tenants SET status = 'Suspended' WHERE id = ?", B.tenantId);
    const suspended = await b.api("GET", "/api/contacts");
    expect(suspended.status).toBe(403);
    expect(suspended.json.error.code).toBe("TENANT_SUSPENDED");
    expect((await a.api("GET", "/api/contacts")).status).toBe(200); // the other tenant is unaffected
    await h.sql("UPDATE tenants SET status = 'Active' WHERE id = ?", B.tenantId);
    expect((await b.api("GET", "/api/contacts")).status).toBe(200);
  });

  it("matches the user's email ignoring case and spaces", async () => {
    expect((await h.as("  ADMIN@Globex.TEST ").api("GET", "/api/me")).json.tenant.id).toBe(B.tenantId);
  });

  it("will not let a client choose a tenant: the field is rejected on writes and ignored on reads", async () => {
    for (const body of [{ email: uniqueEmail(), tenantId: B.tenantId }]) {
      const r = await a.api("POST", "/api/contacts", body);
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe("VALIDATION_ERROR");
    }
    expect((await campaign(a, { tenantId: B.tenantId })).status).toBe(400);
    expect((await campaign(a, { createdBy: B.userId })).status).toBe(400);

    const mine = (await contact(a, { companyName: "ReadScopeCo" })).json;
    const read = await a.api("GET", `/api/contacts?tenantId=${B.tenantId}&q=ReadScopeCo`);
    expect(read.json.items.map((c: { id: string }) => c.id)).toEqual([mine.id]);
  });
});

describe("contacts are private to their tenant", () => {
  it("lets each tenant hold the same address as separate contacts", async () => {
    const shared = uniqueEmail("shared");
    const ca = await contact(a, { email: shared, title: "A's view" });
    const cb = await contact(b, { email: shared, title: "B's view" });
    expect(ca.status).toBe(201);
    expect(cb.status).toBe(201);
    expect(ca.json.id).not.toBe(cb.json.id);
    // still unique within one tenant
    expect((await contact(a, { email: shared.toUpperCase() })).json.error.code).toBe("EMAIL_EXISTS");
    expect((await contact(b, { email: shared })).json.error.code).toBe("EMAIL_EXISTS");
    // and each sees only its own copy
    expect((await a.api("GET", `/api/contacts/${ca.json.id}`)).json.title).toBe("A's view");
    expect((await b.api("GET", `/api/contacts/${cb.json.id}`)).json.title).toBe("B's view");
  });

  it("answers 404 (not 403) for another tenant's contact, on every method, and changes nothing", async () => {
    const mine = (await contact(a, { title: "untouched" })).json;
    expect((await b.api("GET", `/api/contacts/${mine.id}`)).status).toBe(404);
    expect((await b.api("PATCH", `/api/contacts/${mine.id}`, { title: "hijacked" })).status).toBe(404);
    expect((await b.api("DELETE", `/api/contacts/${mine.id}`)).status).toBe(404);
    const after = (await a.api("GET", `/api/contacts/${mine.id}`)).json;
    expect(after.title).toBe("untouched");
    expect(after.updatedAt).toBe(mine.updatedAt);
  });

  it("keeps lists, search, counts and industries separate", async () => {
    const tag = `Iso${Date.now().toString(36)}`;
    await contact(a, { companyName: tag, industry: `${tag}-aerospace` });
    await contact(a, { companyName: tag, industry: `${tag}-aerospace` });
    await contact(b, { companyName: tag, industry: `${tag}-shipping` });

    const la = (await a.api("GET", `/api/contacts?q=${tag}`)).json;
    const lb = (await b.api("GET", `/api/contacts?q=${tag}`)).json;
    expect(la.total).toBe(2);
    expect(lb.total).toBe(1);
    expect((await a.api("GET", "/api/contacts/industries")).json.items).toContain(`${tag}-aerospace`);
    expect((await a.api("GET", "/api/contacts/industries")).json.items).not.toContain(`${tag}-shipping`);
    expect((await b.api("GET", "/api/contacts/industries")).json.items).not.toContain(`${tag}-aerospace`);
    // totals in the rows themselves
    const own = async (who: Caller) => (await who.api("GET", "/api/contacts?pageSize=1")).json.total as number;
    const rowsA = (await h.rows<{ n: number }>("SELECT count(*) AS n FROM contacts WHERE tenant_id = ?", h.tenantId))[0]!.n;
    const rowsB = (await h.rows<{ n: number }>("SELECT count(*) AS n FROM contacts WHERE tenant_id = ?", B.tenantId))[0]!.n;
    expect(await own(a)).toBe(rowsA);
    expect(await own(b)).toBe(rowsB);
  });

  it("deleting a contact in one tenant leaves the other tenant's copy alone", async () => {
    const shared = uniqueEmail("del");
    const ca = (await contact(a, { email: shared })).json;
    const cb = (await contact(b, { email: shared })).json;
    expect((await a.api("DELETE", `/api/contacts/${ca.id}`)).status).toBe(204);
    expect((await b.api("GET", `/api/contacts/${cb.id}`)).status).toBe(200);
  });
});

describe("campaigns are private to their tenant", () => {
  it("answers 404 for another tenant's campaign on every route, and changes nothing", async () => {
    const mine = (await campaign(a, { name: "A-only" })).json;
    const routes: [string, string, unknown?][] = [
      ["GET", `/api/campaigns/${mine.id}`],
      ["PATCH", `/api/campaigns/${mine.id}`, { subject: "hijacked" }],
      ["DELETE", `/api/campaigns/${mine.id}`],
      ["POST", `/api/campaigns/${mine.id}/duplicate`],
      ["POST", `/api/campaigns/${mine.id}/archive`],
      ["POST", `/api/campaigns/${mine.id}/unarchive`],
      ["POST", `/api/campaigns/${mine.id}/pause`],
      ["POST", `/api/campaigns/${mine.id}/resume`],
      ["POST", `/api/campaigns/${mine.id}/cancel`],
      ["GET", `/api/campaigns/${mine.id}/recipients`],
    ];
    for (const [method, path, body] of routes) {
      const r = await b.api(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    const after = (await a.api("GET", `/api/campaigns/${mine.id}`)).json;
    expect(after).toMatchObject({ name: "A-only", subject: "s", status: "Draft", archivedAt: null });
    // and B did not end up with a copy
    expect((await b.api("GET", "/api/campaigns?q=Copy%20of%20A-only")).json.total).toBe(0);
  });

  it("lists only the caller's campaigns, each showing its own creator", async () => {
    const tag = `list${Date.now().toString(36)}`;
    await campaign(a, { name: `${tag} A1` });
    await campaign(a, { name: `${tag} A2` });
    await campaign(b, { name: `${tag} B1` });
    const la = (await a.api("GET", `/api/campaigns?q=${tag}`)).json;
    const lb = (await b.api("GET", `/api/campaigns?q=${tag}`)).json;
    expect(la.items.map((c: { name: string }) => c.name).sort()).toEqual([`${tag} A1`, `${tag} A2`]);
    expect(lb.items.map((c: { name: string }) => c.name)).toEqual([`${tag} B1`]);
    expect(la.items.every((c: { createdBy: string }) => c.createdBy === h.adminEmail)).toBe(true);
    expect(lb.items[0].createdBy).toBe(bEmail);
    expect((await b.api("GET", `/api/campaigns/${lb.items[0].id}`)).json.createdBy).toBe(bEmail);
  });

  it("cancelling in one tenant never touches the other tenant's recipients", async () => {
    const ca = (await campaign(a, { name: "send-a" })).json;
    const cb = (await campaign(b, { name: "send-b" })).json;
    for (const [c, tenantId] of [[ca, h.tenantId], [cb, B.tenantId]] as const) {
      await h.sql("UPDATE campaigns SET status='Sending' WHERE id=?", c.id);
      for (let i = 1; i <= 2; i++) {
        await h.sql(
          "INSERT INTO campaign_recipients (id,tenant_id,campaign_id,email_snapshot,personalization_snapshot,sequence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
          `${c.id}-${i}`, tenantId, c.id, `p${i}@example.test`, "{}", i, Date.now(), Date.now(),
        );
      }
    }
    await a.api("POST", `/api/campaigns/${ca.id}/cancel`);
    expect((await a.api("GET", `/api/campaigns/${ca.id}`)).json.totals.Cancelled).toBe(2);
    expect((await b.api("GET", `/api/campaigns/${cb.id}`)).json.totals).toMatchObject({ Pending: 2, Cancelled: 0 });
  });
});

describe("imports are private to their tenant", () => {
  it("imports the same file into each tenant separately, creating each tenant its own contacts", async () => {
    const text = bigCsv(5, "samefile");
    const ia = await upload(a, { filename: "same.csv", text });
    const ib = await upload(b, { filename: "same.csv", text });
    expect(ia.json).toMatchObject({ createdContacts: 5, existingContacts: 0, createdBy: h.adminEmail });
    // B's copy of the same addresses is brand new for B, not "already existing"
    expect(ib.json).toMatchObject({ createdContacts: 5, existingContacts: 0, createdBy: bEmail });

    const owners = await h.rows<{ tenant_id: string; n: number }>("SELECT tenant_id, count(*) AS n FROM contacts WHERE normalized_email LIKE 'samefile%' GROUP BY tenant_id");
    expect(Object.fromEntries(owners.map((o) => [o.tenant_id, o.n]))).toEqual({ [h.tenantId]: 5, [B.tenantId]: 5 });
  });

  it("links an import's rows only to contacts of the same tenant", async () => {
    const ib = (await upload(b, { filename: "links.csv", text: bigCsv(4, "linkcheck") })).json;
    const crossed = await h.rows(
      "SELECT r.id FROM import_rows r JOIN contacts c ON c.id = r.contact_id WHERE r.import_id = ? AND (c.tenant_id <> r.tenant_id OR r.tenant_id <> ?)",
      ib.id, B.tenantId,
    );
    expect(crossed).toEqual([]);
    const linked = await h.rows<{ n: number }>("SELECT count(*) AS n FROM import_rows WHERE import_id = ? AND contact_id IS NOT NULL", ib.id);
    expect(linked[0]!.n).toBe(4);
  });

  it("hides another tenant's import, its rows and its rejected-rows report", async () => {
    const ia = (await upload(a, { filename: "private.csv", text: bigCsv(3, "priv", (i) => (i === 1 ? ["A", "B", "T", "C", "bad", "", "", "", "", "", "", "", ""] : null)) })).json;
    expect((await b.api("GET", `/api/imports/${ia.id}`)).status).toBe(404);
    expect((await b.api("GET", `/api/imports/${ia.id}/rows`)).status).toBe(404);
    expect((await b.text(`/api/imports/${ia.id}/rejected-rows.csv`)).status).toBe(404);
    expect((await a.text(`/api/imports/${ia.id}/rejected-rows.csv`)).status).toBe(200);
    expect((await b.api("GET", "/api/imports?pageSize=100")).json.items.map((i: { id: string }) => i.id)).not.toContain(ia.id);
    expect((await a.api("GET", "/api/imports?pageSize=100")).json.items.map((i: { id: string }) => i.id)).toContain(ia.id);
  });

  it("will not let a campaign target another tenant's import, on create or edit", async () => {
    const ia = (await upload(a, { filename: "mine.csv", text: bigCsv(2, "target") })).json;
    const refused = await campaign(b, { recipientImportId: ia.id });
    expect(refused.status).toBe(400);
    expect(refused.json.error.details[0].path).toBe("recipientImportId");
    const cb = (await campaign(b)).json;
    expect((await b.api("PATCH", `/api/campaigns/${cb.id}`, { recipientImportId: ia.id })).status).toBe(400);
    expect((await b.api("GET", `/api/campaigns/${cb.id}`)).json.recipientImportId).toBeNull();
    // its own tenant can
    expect((await campaign(a, { recipientImportId: ia.id })).status).toBe(201);
  });
});

describe("the database itself refuses to cross tenants", () => {
  const now = Date.now();
  const expectRejected = async (statement: string, ...params: unknown[]) => {
    await expect(h.sql(statement, ...params)).rejects.toThrow(/FOREIGN KEY|constraint/i);
  };

  it("rejects a recipient whose campaign belongs to another tenant", async () => {
    const ca = (await campaign(a)).json;
    await expectRejected(
      "INSERT INTO campaign_recipients (id,tenant_id,campaign_id,email_snapshot,personalization_snapshot,sequence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      "x-camp", B.tenantId, ca.id, "p@example.test", "{}", 1, now, now,
    );
  });

  it("rejects a recipient whose contact belongs to another tenant", async () => {
    const cb = (await campaign(b)).json;
    const contactOfA = (await contact(a)).json;
    await expectRejected(
      "INSERT INTO campaign_recipients (id,tenant_id,campaign_id,contact_id,email_snapshot,personalization_snapshot,sequence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      "x-contact", B.tenantId, cb.id, contactOfA.id, "p@example.test", "{}", 1, now, now,
    );
  });

  it("rejects an import row whose import or contact belongs to another tenant", async () => {
    const ia = (await upload(a, { filename: "fk.csv", text: bigCsv(1, "fkimp") })).json;
    await expectRejected(
      "INSERT INTO import_rows (id,tenant_id,import_id,row_number,outcome,created_at) VALUES (?,?,?,?,?,?)",
      "x-row", B.tenantId, ia.id, 999, "Blank", now,
    );
    const contactOfA = (await contact(a)).json;
    await expectRejected(
      "INSERT INTO import_rows (id,tenant_id,import_id,row_number,outcome,contact_id,created_at) VALUES (?,?,?,?,?,?,?)",
      "x-row2", h.tenantId, ia.id, 998, "Existing", (await contact(b)).json.id, now,
    );
    expect(contactOfA.id).toBeTruthy();
  });

  it("rejects a campaign or import created by a user of another tenant", async () => {
    await expectRejected(
      "INSERT INTO campaigns (id,tenant_id,name,subject,html_body,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      "x-camp2", h.tenantId, "n", "s", "b", B.userId, now, now,
    );
    await expectRejected(
      "INSERT INTO imports (id,tenant_id,filename,file_size,column_mapping,total_rows,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)",
      "x-imp", h.tenantId, "f.csv", 1, "{}", 1, B.userId, now,
    );
  });

  it("rejects rows with no tenant or an unknown tenant", async () => {
    await expectRejected("INSERT INTO contacts (id,tenant_id,email,normalized_email,created_at,updated_at) VALUES (?,?,?,?,?,?)", "x-c1", "no-such-tenant", "n@example.test", "n@example.test", now, now);
    await expectRejected("INSERT INTO contacts (id,tenant_id,email,normalized_email,created_at,updated_at) VALUES (?,?,?,?,?,?)", "x-c2", null, "n2@example.test", "n2@example.test", now, now);
  });

  it("will not delete a tenant that still owns data or users", async () => {
    await expectRejected("DELETE FROM tenants WHERE id = ?", h.tenantId);
    await expectRejected("DELETE FROM tenants WHERE id = ?", B.tenantId);
    expect((await a.api("GET", "/api/me")).status).toBe(200);
  });
});
