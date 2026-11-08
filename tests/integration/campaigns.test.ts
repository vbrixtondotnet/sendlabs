import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness";
import type { CampaignStatus, RecipientStatus } from "../../src/shared/types";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.dispose(); });

const body = { name: "Access-to-SQL", subject: "Hi {{firstName}}", htmlBody: "<p>Hello {{firstName}}</p>" };
const create = (over: Record<string, unknown> = {}) => h.api("POST", "/api/campaigns", { ...body, ...over });

/** Simulates a launched campaign (launch itself is not built yet) by writing rows directly. */
async function launched(status: CampaignStatus, recipients: RecipientStatus[] = []) {
  const c = (await create()).json;
  await h.sql("UPDATE campaigns SET status = ?, launched_at = ?, next_run_at = ? WHERE id = ?", status, Date.now(), Date.now() + 1000, c.id);
  for (const [i, st] of recipients.entries()) {
    await h.sql(
      "INSERT INTO campaign_recipients (id,campaign_id,contact_id,email_snapshot,personalization_snapshot,sequence,status,skip_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      `${c.id}-r${i}`, c.id, null, `person${i}@example.test`, "{}", i + 1, st, st === "Skipped" ? "Suppressed" : null, Date.now(), Date.now(),
    );
  }
  return c.id as string;
}

describe("campaign CRUD", () => {
  it("creates a Draft with defaults, the actor as owner, and zero totals", async () => {
    const r = await create();
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      name: "Access-to-SQL",
      status: "Draft",
      createdBy: "dev@local",
      dailyLimit: 500,
      sendWindowStart: "09:00",
      sendWindowEnd: "17:00",
      timezone: "America/Los_Angeles",
      textBody: null,
      nextRunAt: null,
      archivedAt: null,
    });
    expect(Object.values(r.json.totals).every((n) => n === 0)).toBe(true);
    expect(Object.keys(r.json.totals).sort()).toEqual(["Accepted", "Cancelled", "Failed", "Pending", "Processing", "Queued", "Skipped"]);
  });

  it("ignores any attempt to set status or owner, by rejecting it", async () => {
    expect((await create({ status: "Sending" })).status).toBe(400);
    expect((await create({ createdBy: "someone-else" })).status).toBe(400);
  });

  it("validates input with field-level errors", async () => {
    const r = await create({ name: "", dailyLimit: 5000, sendWindowStart: "18:00", timezone: "Mars/Base" });
    expect(r.status).toBe(400);
    const paths = r.json.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["name", "dailyLimit", "timezone"]));
  });

  it("gets one campaign with bodies, and 404s on an unknown id", async () => {
    const c = (await create()).json;
    const r = await h.api("GET", `/api/campaigns/${c.id}`);
    expect(r.json.htmlBody).toBe(body.htmlBody);
    expect((await h.api("GET", "/api/campaigns/nope")).status).toBe(404);
  });

  it("lists summaries without bodies, with totals, filters and pagination", async () => {
    const tag = `lst${Date.now().toString(36)}`;
    const a = (await create({ name: `${tag} A` })).json;
    await create({ name: `${tag} B` });
    await create({ name: `${tag} C` });
    await h.sql("UPDATE campaigns SET status='Paused' WHERE id=?", a.id);

    const all = await h.api("GET", `/api/campaigns?q=${tag}&pageSize=2`);
    expect(all.json).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(all.json.items).toHaveLength(2);
    expect(all.json.items[0]).not.toHaveProperty("htmlBody");
    expect(all.json.items[0]).toHaveProperty("totals");
    expect((await h.api("GET", `/api/campaigns?q=${tag}&status=Paused`)).json.total).toBe(1);
    expect((await h.api("GET", `/api/campaigns?q=${tag}&status=Delivered`)).status).toBe(400);
  });

  it("reflects recipient counts by status in the totals", async () => {
    const id = await launched("Sending", ["Accepted", "Accepted", "Failed", "Pending", "Pending", "Pending", "Queued"]);
    const r = await h.api("GET", `/api/campaigns/${id}`);
    expect(r.json.totals).toMatchObject({ Accepted: 2, Failed: 1, Pending: 3, Queued: 1, Processing: 0 });
    const list = await h.api("GET", `/api/campaigns?q=Access-to-SQL&pageSize=100`);
    expect(list.json.items.find((c: { id: string }) => c.id === id).totals.Accepted).toBe(2);
  });

  it("edits only drafts, merging the send window with stored values", async () => {
    const c = (await create()).json;
    const ok = await h.api("PATCH", `/api/campaigns/${c.id}`, { subject: "New subject", dailyLimit: 300 });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ subject: "New subject", dailyLimit: 300, status: "Draft", name: body.name });

    // start 18:00 alone is valid on its own but not against the stored 17:00 end
    const bad = await h.api("PATCH", `/api/campaigns/${c.id}`, { sendWindowStart: "18:00" });
    expect(bad.status).toBe(400);
    expect((await h.api("PATCH", `/api/campaigns/${c.id}`, { status: "Sending" })).status).toBe(400);
    expect((await h.api("PATCH", `/api/campaigns/${c.id}`, {})).status).toBe(400);
    expect((await h.api("PATCH", "/api/campaigns/nope", { subject: "x" })).status).toBe(404);
  });

  it("locks content once the campaign has left Draft", async () => {
    const id = await launched("Sending");
    const r = await h.api("PATCH", `/api/campaigns/${id}`, { subject: "sneaky" });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("CAMPAIGN_LOCKED");
    expect((await h.api("GET", `/api/campaigns/${id}`)).json.subject).toBe(body.subject);
  });

  it("deletes drafts only", async () => {
    const draft = (await create()).json;
    expect((await h.api("DELETE", `/api/campaigns/${draft.id}`)).status).toBe(204);
    expect((await h.api("GET", `/api/campaigns/${draft.id}`)).status).toBe(404);
    expect((await h.api("DELETE", `/api/campaigns/${draft.id}`)).status).toBe(404);
    const id = await launched("Completed");
    const r = await h.api("DELETE", `/api/campaigns/${id}`);
    expect(r.status).toBe(409);
    expect((await h.api("GET", `/api/campaigns/${id}`)).status).toBe(200);
  });

  it("duplicates into a fresh Draft without recipients or schedule state", async () => {
    const id = await launched("Completed", ["Accepted", "Accepted"]);
    await h.api("PATCH", `/api/campaigns/${id}`, {}); // no-op rejected, just exercising the route
    const r = await h.api("POST", `/api/campaigns/${id}/duplicate`);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ name: `Copy of ${body.name}`, status: "Draft", subject: body.subject, htmlBody: body.htmlBody });
    expect(r.json.id).not.toBe(id);
    expect(r.json.nextRunAt).toBeNull();
    expect(r.json.launchedAt).toBeNull();
    expect(Object.values(r.json.totals).every((n) => n === 0)).toBe(true);
    expect((await h.api("POST", "/api/campaigns/nope/duplicate")).status).toBe(404);
  });

  it("archives and unarchives, hides archived by default, and refuses while in flight", async () => {
    const tag = `arc${Date.now().toString(36)}`;
    const c = (await create({ name: tag })).json;
    const a = await h.api("POST", `/api/campaigns/${c.id}/archive`);
    expect(a.json.archivedAt).not.toBeNull();
    expect((await h.api("GET", `/api/campaigns?q=${tag}`)).json.total).toBe(0);
    expect((await h.api("GET", `/api/campaigns?q=${tag}&archived=include`)).json.total).toBe(1);
    expect((await h.api("GET", `/api/campaigns?q=${tag}&archived=only`)).json.total).toBe(1);
    const again = await h.api("POST", `/api/campaigns/${c.id}/archive`);
    expect(again.json.archivedAt).toBe(a.json.archivedAt); // idempotent, keeps the original time
    expect((await h.api("POST", `/api/campaigns/${c.id}/unarchive`)).json.archivedAt).toBeNull();
    expect((await h.api("GET", `/api/campaigns?q=${tag}`)).json.total).toBe(1);

    for (const s of ["Sending", "Queued", "Queuing"] as const) {
      const id = await launched(s);
      const r = await h.api("POST", `/api/campaigns/${id}/archive`);
      expect(r.status, s).toBe(409);
      expect(r.json.error.code).toBe("CAMPAIGN_IN_FLIGHT");
    }
  });
});

describe("pause, resume and cancel", () => {
  it("pauses a sending campaign and stops the daily tick", async () => {
    const id = await launched("Sending", ["Pending"]);
    const r = await h.api("POST", `/api/campaigns/${id}/pause`);
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("Paused");
    expect(r.json.nextRunAt).toBeNull();
    expect(r.json.completedAt).toBeNull();
  });

  it("resumes a paused campaign and makes it due at the next tick", async () => {
    const id = await launched("Paused");
    const r = await h.api("POST", `/api/campaigns/${id}/resume`);
    expect(r.json.status).toBe("Sending");
    expect(r.json.nextRunAt).not.toBeNull();
  });

  it("rejects illegal actions with INVALID_TRANSITION and changes nothing", async () => {
    const cases: [CampaignStatus, "pause" | "resume" | "cancel"][] = [
      ["Draft", "pause"], ["Draft", "resume"], ["Draft", "cancel"],
      ["Sending", "resume"], ["Paused", "pause"],
      ["Completed", "pause"], ["Completed", "cancel"], ["Cancelled", "resume"], ["Cancelled", "cancel"],
    ];
    for (const [status, action] of cases) {
      const id = status === "Draft" ? (await create()).json.id : await launched(status);
      const r = await h.api("POST", `/api/campaigns/${id}/${action}`);
      expect(r.status, `${status} + ${action}`).toBe(409);
      expect(r.json.error.code).toBe("INVALID_TRANSITION");
      expect((await h.api("GET", `/api/campaigns/${id}`)).json.status).toBe(status);
    }
  });

  it("cancel stops unsent recipients only, and keeps the send history", async () => {
    const id = await launched("Sending", ["Accepted", "Failed", "Processing", "Queued", "Pending", "Pending", "Skipped"]);
    const r = await h.api("POST", `/api/campaigns/${id}/cancel`);
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("Cancelled");
    expect(r.json.nextRunAt).toBeNull();
    expect(r.json.completedAt).not.toBeNull();
    expect(r.json.totals).toMatchObject({
      Accepted: 1, // already sent: cannot be recalled
      Failed: 1,
      Processing: 1, // in flight: the consumer must re-check the campaign status
      Skipped: 1,
      Cancelled: 3, // the Queued one and both Pending ones
      Pending: 0,
      Queued: 0,
    });
  });

  it("cancel leaves other campaigns' recipients alone", async () => {
    const mine = await launched("Sending", ["Pending", "Pending"]);
    const other = await launched("Sending", ["Pending", "Pending"]);
    await h.api("POST", `/api/campaigns/${mine}/cancel`);
    expect((await h.api("GET", `/api/campaigns/${other}`)).json.totals.Pending).toBe(2);
  });

  it("cancels from Paused and from Failed", async () => {
    for (const s of ["Paused", "Failed"] as const) {
      const id = await launched(s, ["Pending"]);
      const r = await h.api("POST", `/api/campaigns/${id}/cancel`);
      expect(r.json.status, s).toBe("Cancelled");
      expect(r.json.totals.Cancelled).toBe(1);
    }
  });

  it("404s for an unknown campaign", async () => {
    for (const a of ["pause", "resume", "cancel"]) expect((await h.api("POST", `/api/campaigns/nope/${a}`)).status).toBe(404);
  });
});

describe("campaign recipients", () => {
  it("lists in send order with pagination, status filter and email search", async () => {
    const id = await launched("Sending", ["Accepted", "Pending", "Pending", "Failed", "Pending"]);
    const p1 = await h.api("GET", `/api/campaigns/${id}/recipients?pageSize=2`);
    expect(p1.json).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(p1.json.items.map((r: { sequence: number }) => r.sequence)).toEqual([1, 2]);
    const p3 = await h.api("GET", `/api/campaigns/${id}/recipients?pageSize=2&page=3`);
    expect(p3.json.items.map((r: { sequence: number }) => r.sequence)).toEqual([5]);

    const pending = await h.api("GET", `/api/campaigns/${id}/recipients?status=Pending`);
    expect(pending.json.total).toBe(3);
    expect(pending.json.items.every((r: { status: string }) => r.status === "Pending")).toBe(true);
    expect((await h.api("GET", `/api/campaigns/${id}/recipients?q=PERSON3`)).json.total).toBe(1);
    expect((await h.api("GET", `/api/campaigns/${id}/recipients?status=Delivered`)).status).toBe(400);
  });

  it("exposes status, attempts and skip reason, but no raw internals", async () => {
    const id = await launched("Sending", ["Skipped"]);
    const r = (await h.api("GET", `/api/campaigns/${id}/recipients`)).json.items[0];
    expect(r).toMatchObject({ status: "Skipped", skipReason: "Suppressed", attemptCount: 0, email: "person0@example.test" });
    expect(r).not.toHaveProperty("leaseExpiresAt");
    expect(r).not.toHaveProperty("emailSnapshot");
  });

  it("404s for an unknown campaign", async () => {
    expect((await h.api("GET", "/api/campaigns/nope/recipients")).status).toBe(404);
  });
});
