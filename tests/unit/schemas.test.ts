import { describe, expect, it } from "vitest";
import {
  campaignCreateSchema,
  campaignListQuery,
  campaignPatchSchema,
  contactCreateSchema,
  contactListQuery,
  contactPatchSchema,
  isValidTimeZone,
  SIGNATURE_MAX,
  tenantUpdateSchema,
  websiteField,
} from "../../src/shared/schemas";
import { isValidEmail, normalizeEmail } from "../../src/shared/email";

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;

describe("email rules", () => {
  it("normalizes with trim + lower-case only", () => {
    expect(normalizeEmail("  Nick.Harbaugh+Tag@Example.COM ")).toBe("nick.harbaugh+tag@example.com");
    expect(normalizeEmail("first.last@gmail.com")).toBe("first.last@gmail.com"); // dots are kept
  });
  it("accepts ordinary addresses and rejects malformed ones", () => {
    for (const good of ["a@b.co", "oswaldo.sanchez@voxanalyzer.com.ve", "x+y@sub.domain.org"]) expect(isValidEmail(good)).toBe(true);
    for (const bad of ["", "no-at", "a@b", "a@@b.com", "a b@c.com", "a@b..com", "a..b@c.com", "a@.com", "a@-b.com", "<x@y.com>", "a@b.c"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });
});

describe("contact schemas", () => {
  const base = { email: "  Nick@Flexecutioninc.com " };

  it("applies defaults for everything except the email", () => {
    const r = contactCreateSchema.parse(base);
    expect(r.email).toBe("Nick@Flexecutioninc.com"); // trimmed as entered, normalized by the API
    expect(r).toMatchObject({ firstName: "", employees: null, annualRevenue: null, consentStatus: "Unknown", consentSource: null });
  });
  it("requires a valid email", () => {
    expect(ok(contactCreateSchema, {})).toBe(false);
    expect(ok(contactCreateSchema, { email: "nope" })).toBe(false);
  });
  it("rejects unknown properties instead of dropping them", () => {
    expect(ok(contactCreateSchema, { ...base, firstNmae: "typo" })).toBe(false);
  });
  it("allows only http(s) URLs or empty (the UI renders these as links)", () => {
    expect(ok(contactCreateSchema, { ...base, linkedinUrl: "http://www.linkedin.com/in/x" })).toBe(true);
    expect(ok(contactCreateSchema, { ...base, website: "" })).toBe(true);
    expect(ok(contactCreateSchema, { ...base, website: "javascript:alert(1)" })).toBe(false);
    expect(ok(contactCreateSchema, { ...base, website: "data:text/html,x" })).toBe(false);
    expect(ok(contactCreateSchema, { ...base, website: "example.com" })).toBe(false);
  });
  it("validates numbers and consent", () => {
    expect(ok(contactCreateSchema, { ...base, employees: 53, annualRevenue: 16175000 })).toBe(true);
    expect(ok(contactCreateSchema, { ...base, employees: -1 })).toBe(false);
    expect(ok(contactCreateSchema, { ...base, employees: 1.5 })).toBe(false);
    expect(ok(contactCreateSchema, { ...base, employees: "53" })).toBe(false);
    expect(ok(contactCreateSchema, { ...base, consentStatus: "Maybe" })).toBe(false);
  });
  it("PATCH needs at least one field and applies no defaults", () => {
    expect(ok(contactPatchSchema, {})).toBe(false);
    expect(contactPatchSchema.parse({ title: "CEO" })).toEqual({ title: "CEO" });
    expect(ok(contactPatchSchema, { id: "x" })).toBe(false);
  });
  it("coerces list queries and treats empty values as absent", () => {
    expect(contactListQuery.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(contactListQuery.parse({ page: "3", pageSize: "50", q: "", industry: "" })).toEqual({ page: 3, pageSize: 50 });
    expect(ok(contactListQuery, { pageSize: "101" })).toBe(false);
    expect(ok(contactListQuery, { page: "0" })).toBe(false);
    expect(ok(contactListQuery, { consent: "Maybe" })).toBe(false);
  });
});

describe("campaign schemas", () => {
  const base = { name: "Access-to-SQL", subject: "Hi {{firstName}}", htmlBody: "<p>x</p>" };

  it("applies the drip defaults", () => {
    expect(campaignCreateSchema.parse(base)).toMatchObject({
      textBody: null,
      dailyLimit: 500,
      sendWindowStart: "09:00",
      sendWindowEnd: "17:00",
      timezone: "America/Los_Angeles",
    });
  });
  it("requires name, subject and body", () => {
    for (const k of ["name", "subject", "htmlBody"] as const) {
      expect(ok(campaignCreateSchema, { ...base, [k]: "" })).toBe(false);
      expect(ok(campaignCreateSchema, { ...base, [k]: undefined })).toBe(false);
    }
    expect(ok(campaignCreateSchema, { ...base, name: "   " })).toBe(false);
  });
  it("bounds the daily limit to 1..2000 whole numbers", () => {
    for (const n of [1, 500, 2000]) expect(ok(campaignCreateSchema, { ...base, dailyLimit: n })).toBe(true);
    for (const n of [0, -5, 2001, 10.5]) expect(ok(campaignCreateSchema, { ...base, dailyLimit: n })).toBe(false);
  });
  it("validates the send window", () => {
    expect(ok(campaignCreateSchema, { ...base, sendWindowStart: "10:30", sendWindowEnd: "16:45" })).toBe(true);
    expect(ok(campaignCreateSchema, { ...base, sendWindowStart: "9:00" })).toBe(false);
    expect(ok(campaignCreateSchema, { ...base, sendWindowStart: "24:00", sendWindowEnd: "23:59" })).toBe(false);
    expect(ok(campaignCreateSchema, { ...base, sendWindowStart: "17:00", sendWindowEnd: "09:00" })).toBe(false);
    expect(ok(campaignCreateSchema, { ...base, sendWindowStart: "09:00", sendWindowEnd: "09:00" })).toBe(false);
  });
  it("validates IANA timezones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(ok(campaignCreateSchema, { ...base, timezone: "Mars/Olympus" })).toBe(false);
  });
  it("never lets a client set status or ownership", () => {
    for (const extra of [{ status: "Sending" }, { createdBy: "x" }, { id: "x" }, { launchedAt: 1 }]) {
      expect(ok(campaignCreateSchema, { ...base, ...extra })).toBe(false);
      expect(ok(campaignPatchSchema, extra)).toBe(false);
    }
  });
  it("PATCH needs at least one field", () => {
    expect(ok(campaignPatchSchema, {})).toBe(false);
    expect(campaignPatchSchema.parse({ dailyLimit: 300 })).toEqual({ dailyLimit: 300 });
  });
  it("list query defaults to excluding archived", () => {
    expect(campaignListQuery.parse({})).toMatchObject({ archived: "exclude", page: 1, pageSize: 25 });
    expect(ok(campaignListQuery, { status: "Delivered" })).toBe(false);
    expect(ok(campaignListQuery, { archived: "maybe" })).toBe(false);
  });
});

describe("website", () => {
  it("accepts domains and http(s) addresses, and empty (to clear it)", () => {
    for (const good of ["example.com", "sabertoothsoftwarelabs.net", "www.example.co.uk", "https://example.com", "http://example.com/about?x=1", "example.com:8080/a", "EXAMPLE.com", "sub.domain.example.org/", "  example.com  ", ""]) {
      expect(ok(websiteField, good), JSON.stringify(good)).toBe(true);
    }
  });
  it("rejects spaces, other schemes, markup, and things that are not a domain", () => {
    for (const bad of ["example", "not a website", "ftp://example.com", "javascript:alert(1)", "javascript:a.b", "mailto:a@b.com", "<script>x.y</script>", "exa mple.com", "example..com", ".com", "-a.com/x y", "http://", "http://example", "example.com/<b>", "a@b.com", "x".repeat(201) + ".com"]) {
      expect(ok(websiteField, bad), bad).toBe(false);
    }
  });
  it("is accepted on its own in a company update, and an update with nothing in it is still refused", () => {
    expect(ok(tenantUpdateSchema, { website: "example.com" })).toBe(true);
    expect(ok(tenantUpdateSchema, { website: "" })).toBe(true);
    expect(ok(tenantUpdateSchema, {})).toBe(false);
    expect(ok(tenantUpdateSchema, { website: "example.com", slug: "hacked" })).toBe(false);
  });
});

describe("campaign signature", () => {
  const base = { name: "N", subject: "S", htmlBody: "<p>x</p>" };
  it("defaults to none, and accepts text up to the limit", () => {
    expect(campaignCreateSchema.parse(base).signature).toBe("");
    expect(ok(campaignCreateSchema, { ...base, signature: "Best regards,\nRico" })).toBe(true);
    expect(ok(campaignCreateSchema, { ...base, signature: "x".repeat(SIGNATURE_MAX) })).toBe(true);
  });
  it("refuses more than the limit and anything but text", () => {
    expect(ok(campaignCreateSchema, { ...base, signature: "x".repeat(SIGNATURE_MAX + 1) })).toBe(false);
    for (const signature of [5, null, ["a"], {}]) expect(ok(campaignCreateSchema, { ...base, signature }), JSON.stringify(signature)).toBe(false);
  });
  it("can be changed on its own in an update", () => {
    expect(ok(campaignPatchSchema, { signature: "New" })).toBe(true);
    expect(ok(campaignPatchSchema, { signature: "" })).toBe(true);
  });
});

describe("unsubscribe settings in a company update", () => {
  it("accept true and false, each on its own or together", () => {
    for (const v of [{ requireUnsubscribeLink: true }, { requireUnsubscribeLink: false }, { oneClickUnsubscribe: false }, { requireUnsubscribeLink: false, oneClickUnsubscribe: true }]) {
      expect(ok(tenantUpdateSchema, v), JSON.stringify(v)).toBe(true);
    }
  });
  it("refuse anything that is not a boolean", () => {
    for (const v of ["true", 1, 0, null, "yes", []]) {
      expect(ok(tenantUpdateSchema, { requireUnsubscribeLink: v }), JSON.stringify(v)).toBe(false);
      expect(ok(tenantUpdateSchema, { oneClickUnsubscribe: v }), JSON.stringify(v)).toBe(false);
    }
  });
  it("count as something to change, so an update of only these is not 'nothing to change'", () => {
    expect(ok(tenantUpdateSchema, {})).toBe(false);
    expect(ok(tenantUpdateSchema, { requireUnsubscribeLink: false })).toBe(true);
  });
});

describe("campaign footer (removed)", () => {
  const base = { name: "N", subject: "S", htmlBody: "<p>x</p>" };
  it("is no longer a field: the footer is fixed, so a client cannot send one", () => {
    expect(ok(campaignCreateSchema, { ...base, footer: "<p>mine</p>" })).toBe(false);
    expect(ok(campaignPatchSchema, { footer: "<p>mine</p>" })).toBe(false);
    expect(ok(campaignCreateSchema, base)).toBe(true);
  });
});
