import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import { applyMigrations } from "./harness";

/**
 * Migration 0015 turns every plain-text signature saved before the rich-text editor into the same text as HTML. It is
 * checked on its own database: applied up to 0014, filled with old-style rows, then migrated.
 */
let proxy: PlatformProxy<Env>;
let d1: D1Database;

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ persist: false });
  d1 = proxy.env.DB;
  await applyMigrations(d1, (name) => name < "0015");
  await d1.prepare("INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES ('t1', 'Acme', 'acme', 1, 1)").run();
  await d1.prepare("INSERT INTO access (id, name, description, sort_order, created_at) VALUES ('x', 'X', 'x', 9, 1) ON CONFLICT DO NOTHING").run();
  await d1
    .prepare("INSERT INTO users (id, tenant_id, email, normalized_email, display_name, password_hash, access_id, status, created_at, updated_at) VALUES ('u1', 't1', 'a@acme.test', 'a@acme.test', 'A', 'x', 'administrator', 'Active', 1, 1)")
    .run();
});
afterAll(async () => { await proxy.dispose(); });

async function campaignWith(id: string, signature: string) {
  await d1
    .prepare("INSERT INTO campaigns (id, tenant_id, name, subject, html_body, signature, created_by, created_at, updated_at) VALUES (?1, 't1', 'N', 'S', '<p>x</p>', ?2, 'u1', 1, 1)")
    .bind(id, signature)
    .run();
}
const signatureOf = async (id: string) => (await d1.prepare("SELECT signature FROM campaigns WHERE id = ?").bind(id).first<{ signature: string }>())!.signature;

const MIGRATION = async () => {
  const { migrationFiles } = await import("./harness");
  const file = migrationFiles().find((f) => f.name.startsWith("0015"))!;
  await d1.batch(file.statements.map((s) => d1.prepare(s)));
};

describe("migration 0015: plain-text signatures become HTML", () => {
  it("converts every kind of old signature, and leaves empty ones empty", async () => {
    await campaignWith("c-plain", "Best regards,\nRico Prinsipe\nMarketing Admin | Sabertooth Software Labs\nsabertoothsoftwarelabs.net");
    await campaignWith("c-crlf", "Line one\r\nLine two\rLine three");
    await campaignWith("c-special", `Tom & Jerry <Co> "quoted" it's`);
    await campaignWith("c-spaces", "  \n  Padded signature \n\t ");
    await campaignWith("c-merge", "Hi {{firstName}}");
    await campaignWith("c-empty", "");
    await campaignWith("c-blank", " \n\t ");
    await campaignWith("c-markup", "<script>alert(1)</script>");
    await MIGRATION();

    expect(await signatureOf("c-plain")).toBe("<p>Best regards,<br/>Rico Prinsipe<br/>Marketing Admin | Sabertooth Software Labs<br/>sabertoothsoftwarelabs.net</p>");
    expect(await signatureOf("c-crlf")).toBe("<p>Line one<br/>Line two<br/>Line three</p>");
    expect(await signatureOf("c-special")).toBe("<p>Tom &amp; Jerry &lt;Co&gt; &quot;quoted&quot; it&#39;s</p>");
    expect(await signatureOf("c-spaces")).toBe("<p>Padded signature</p>");
    expect(await signatureOf("c-merge")).toBe("<p>Hi {{firstName}}</p>");
    expect(await signatureOf("c-empty")).toBe("");
    expect(await signatureOf("c-blank")).toBe(" \n\t "); // nothing to convert: left as it was, and it reads as empty
    expect(await signatureOf("c-markup")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"); // old text is text, never markup
  });

  it("only touches signatures, not the bodies or anything else", async () => {
    const row = await d1.prepare("SELECT html_body, name, subject FROM campaigns WHERE id = 'c-plain'").first<{ html_body: string; name: string; subject: string }>();
    expect(row).toEqual({ html_body: "<p>x</p>", name: "N", subject: "S" });
  });
});
