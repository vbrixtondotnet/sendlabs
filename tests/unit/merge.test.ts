import { describe, expect, it } from "vitest";
import { applySignature, composeEmailHtml, defaultSignature, postalFooterHtml, PREVIEW_UNSUBSCRIBE_URL, renderTemplate, SAMPLE_CONTACT, SIGNATURE_TAG, signatureHtml, UNSUBSCRIBE_TAG, unknownTags, unsubscribeFooterHtml } from "../../src/shared/merge";
import { DEFAULT_HTML_BODY } from "../../src/shared/defaults";

describe("defaultSignature", () => {
  const who = { name: "Rico Prinsipe", position: "Marketing Admin" };
  const tenant = { name: "Sabertooth Software Labs", website: "sabertoothsoftwarelabs.net" };

  it("is the sign-off, the name, then position | company, then the website", () => {
    expect(defaultSignature(who, tenant)).toBe("Best regards,\nRico Prinsipe\nMarketing Admin | Sabertooth Software Labs\nsabertoothsoftwarelabs.net");
  });
  it("leaves out the separator when there is no position", () => {
    expect(defaultSignature({ ...who, position: "" }, tenant)).toBe("Best regards,\nRico Prinsipe\nSabertooth Software Labs\nsabertoothsoftwarelabs.net");
  });
  it("leaves out the website line when there is no website", () => {
    expect(defaultSignature(who, { ...tenant, website: "" })).toBe("Best regards,\nRico Prinsipe\nMarketing Admin | Sabertooth Software Labs");
  });
  it("copes with everything missing, and with stray spaces", () => {
    expect(defaultSignature({ name: "", position: "" }, { name: "Acme", website: "" })).toBe("Best regards,\nAcme");
    expect(defaultSignature({ name: "  Ada   Lovelace ", position: " CTO " }, { name: " Acme  Inc ", website: " acme.test " })).toBe("Best regards,\nAda Lovelace\nCTO | Acme Inc\nacme.test");
  });
});

describe("signatureHtml", () => {
  it("escapes the text and keeps its line breaks", () => {
    expect(signatureHtml("Best regards,\nRico & <Co>")).toBe("<p>Best regards,<br/>Rico &amp; &lt;Co&gt;</p>");
  });
  it("handles Windows line breaks, and trims", () => {
    expect(signatureHtml("  A\r\nB\rC \n")).toBe("<p>A<br/>B<br/>C</p>");
  });
  it("is empty for nothing at all", () => {
    expect(signatureHtml("")).toBe("");
    expect(signatureHtml(" \n\t ")).toBe("");
  });
});

describe("applySignature", () => {
  it("always adds the signature right after the body", () => {
    expect(applySignature("<p>A</p>", "X")).toBe("<p>A</p>\n<p>X</p>");
  });
  it("adds nothing when there is no signature", () => {
    expect(applySignature("<p>A</p>", "")).toBe("<p>A</p>");
    expect(applySignature("<p>A</p>", "  ")).toBe("<p>A</p>");
  });
  it("drops an old {{signature}} tag left in a body, instead of showing it or placing the signature there", () => {
    expect(applySignature(`<p>A</p>${SIGNATURE_TAG}<p>B</p>`, "X")).toBe("<p>A</p><p>B</p>\n<p>X</p>");
    expect(applySignature(`<p>A</p>${SIGNATURE_TAG}`, "")).toBe("<p>A</p>");
    expect(applySignature(`${SIGNATURE_TAG}|${SIGNATURE_TAG}`, "X")).toBe("|\n<p>X</p>");
  });
  it("does not run a signature that contains the tag, or any markup", () => {
    expect(applySignature("<p>A</p>", `${SIGNATURE_TAG}<script>x</script>`)).toBe("<p>A</p>\n<p>{{signature}}&lt;script&gt;x&lt;/script&gt;</p>");
  });
  it("lets merge fields in the signature be filled in afterwards, like the body", () => {
    const html = renderTemplate(applySignature("<p>A</p>", "Hi {{firstName}} at {{companyName}}"), SAMPLE_CONTACT, true);
    expect(html).toContain("Hi Alex at Example Co");
  });
});

describe("the starting body", () => {
  it("is just the message: no sign-off, no signature tag, no footer, no unsubscribe link", () => {
    expect(DEFAULT_HTML_BODY).not.toContain(SIGNATURE_TAG);
    expect(DEFAULT_HTML_BODY).not.toContain(UNSUBSCRIBE_TAG);
    expect(DEFAULT_HTML_BODY).not.toMatch(/Best regards|IT Impact|Unsubscribe|<hr/i);
    expect(DEFAULT_HTML_BODY).toContain("Hi {{firstName}}");
  });
  it("uses only tags that are known", () => {
    expect(unknownTags(DEFAULT_HTML_BODY)).toEqual([]);
  });
  it("carries no made-up postal address: the company's own is added when the email is built", () => {
    expect(DEFAULT_HTML_BODY).not.toMatch(/Example Street|Sample City|IT Impact/);
  });
});

describe("unsubscribeFooterHtml", () => {
  it("is exactly the standard footer, with the sending company's name on the last line", () => {
    expect(unsubscribeFooterHtml("Sabertooth Software Labs")).toBe(`<hr/>
<p style="font-size:12px;color:#666;">
You're receiving this email because we believe our services may be relevant to your business.<br/>
<a href="{{unsubscribeUrl}}">Unsubscribe</a><br/>
Sabertooth Software Labs
</p>`);
  });
  it("has the unsubscribe link, and uses only known tags", () => {
    const footer = unsubscribeFooterHtml("Acme");
    expect(footer).toContain(UNSUBSCRIBE_TAG);
    expect(unknownTags(footer)).toEqual([]);
  });
  it("escapes the company name and tidies its spaces, so it cannot add markup", () => {
    expect(unsubscribeFooterHtml("  Smith &  <b>Sons</b>  ")).toContain("\nSmith &amp; &lt;b&gt;Sons&lt;/b&gt;\n</p>");
    expect(unsubscribeFooterHtml("A\r\nB")).toContain("\nA B\n</p>");
  });
  it("shows the company's own name, never the recipient's: it is written in, not a {{companyName}} merge field", () => {
    expect(unsubscribeFooterHtml("Acme")).not.toContain("{{companyName}}");
  });
});

describe("renderTemplate and the unsubscribe address", () => {
  it("points {{unsubscribeUrl}} at the placeholder address unless given the recipient's own", () => {
    expect(renderTemplate("{{unsubscribeUrl}}", SAMPLE_CONTACT, true)).toBe(PREVIEW_UNSUBSCRIBE_URL);
    expect(renderTemplate("{{unsubscribeUrl}}", SAMPLE_CONTACT, true, "https://app.test/unsubscribe/abc.def")).toBe("https://app.test/unsubscribe/abc.def");
  });
  it("escapes the address in HTML (it goes into an attribute), and not in plain text", () => {
    expect(renderTemplate("{{unsubscribeUrl}}", SAMPLE_CONTACT, true, 'https://a.test/?x=1&y="2"')).toBe("https://a.test/?x=1&amp;y=&quot;2&quot;");
    expect(renderTemplate("{{unsubscribeUrl}}", SAMPLE_CONTACT, false, "https://a.test/?x=1&y=2")).toBe("https://a.test/?x=1&y=2");
  });
});

describe("unknownTags", () => {
  it("still knows the old signature tag, and catches typos", () => {
    expect(unknownTags(`${SIGNATURE_TAG} {{firstName}} {{unsubscribeUrl}}`)).toEqual([]);
    expect(unknownTags("{{signture}} {{firstname}}")).toEqual(["{{signture}}", "{{firstname}}"]);
  });
});

describe("postalFooterHtml", () => {
  it("is the address in small grey text, escaped, one line per line", () => {
    expect(postalFooterHtml("Acme & Sons\n<1> Road")).toBe('<p style="font-size:12px;color:#666666">Acme &amp; Sons<br/>&lt;1&gt; Road</p>');
  });
  it("handles Windows line breaks and trims", () => {
    expect(postalFooterHtml("  A\r\nB  ")).toBe('<p style="font-size:12px;color:#666666">A<br/>B</p>');
  });
  it("is empty without an address", () => {
    expect(postalFooterHtml("")).toBe("");
    expect(postalFooterHtml(" \n ")).toBe("");
  });
});

describe("composeEmailHtml: body, then signature, then the standard footer, then the postal address", () => {
  const parts = (over: Partial<Parameters<typeof composeEmailHtml>[0]> = {}) => ({ body: "<p>Hi {{firstName}}</p>", signature: "Best,\nRico", companyName: "Acme Co", postalAddress: "Acme\n1 Road", unsubscribeFooter: true, ...over });
  const LINK = "https://app.test/unsubscribe/tok.sig";

  it("puts the four parts in that order, with merge fields filled in", () => {
    const html = composeEmailHtml(parts(), SAMPLE_CONTACT, LINK);
    const at = (needle: string) => html.indexOf(needle);
    expect(at("Hi Alex")).toBeGreaterThan(-1);
    expect(at("Hi Alex")).toBeLessThan(at("Best,<br/>Rico"));
    expect(at("Best,<br/>Rico")).toBeLessThan(at("<hr/>"));
    expect(at("<hr/>")).toBeLessThan(at("You're receiving this email"));
    expect(at("You're receiving this email")).toBeLessThan(at("Unsubscribe</a>"));
    expect(at("Unsubscribe</a>")).toBeLessThan(at("Acme Co"));
    expect(at("Acme Co")).toBeLessThan(at("Acme<br/>1 Road"));
    expect(html.trimEnd().endsWith("Acme<br/>1 Road</p>")).toBe(true);
    expect(html).not.toContain("{{");
  });
  it("links the footer's Unsubscribe to the recipient's own address", () => {
    const html = composeEmailHtml(parts(), SAMPLE_CONTACT, LINK);
    expect(html).toContain(`<a href="${LINK}">Unsubscribe</a><br/>`);
  });
  it("uses the placeholder address when no recipient's is given (the editor's preview)", () => {
    expect(composeEmailHtml(parts(), SAMPLE_CONTACT)).toContain(`<a href="${PREVIEW_UNSUBSCRIBE_URL}">Unsubscribe</a>`);
  });
  it("shows the sending company in the footer even when the recipient's company is something else", () => {
    const html = composeEmailHtml(parts({ body: "<p>{{companyName}}</p>" }), { ...SAMPLE_CONTACT, companyName: "Recipient Ltd" }, LINK);
    expect(html).toContain("<p>Recipient Ltd</p>"); // the body's merge field
    expect(html).toContain("<br/>\nAcme Co\n</p>"); // the footer's line
  });
  it("still lets the body carry its own {{unsubscribeUrl}} link, pointing at the same address", () => {
    const html = composeEmailHtml(parts({ body: '<p><a href="{{unsubscribeUrl}}">stop</a></p>' }), SAMPLE_CONTACT, LINK);
    expect(html.split(LINK)).toHaveLength(3);
  });
  it("adds only what there is: no signature, no address", () => {
    const bare = composeEmailHtml(parts({ signature: "", postalAddress: "" }), SAMPLE_CONTACT, LINK);
    expect(bare.startsWith("<p>Hi Alex</p>\n<hr/>")).toBe(true);
    expect(bare).not.toContain("Best,");
    expect(bare.trimEnd().endsWith("Acme Co\n</p>")).toBe(true);
  });
  it("adds no footer at all when the company does not require an unsubscribe link", () => {
    const html = composeEmailHtml(parts({ unsubscribeFooter: false, signature: "", postalAddress: "" }), SAMPLE_CONTACT, LINK);
    expect(html).toBe("<p>Hi Alex</p>");
    expect(html).not.toContain("Unsubscribe");
  });
  it("the structure holds even if the body still has an old signature tag", () => {
    const html = composeEmailHtml(parts({ body: `<p>A</p>${SIGNATURE_TAG}`, signature: "Sig", postalAddress: "" }), SAMPLE_CONTACT, LINK);
    expect(html.startsWith("<p>A</p>\n<p>Sig</p>\n<hr/>")).toBe(true);
    expect(html).not.toContain(SIGNATURE_TAG);
  });
  it("does not run merge fields typed into the postal address: it is shown as written", () => {
    expect(composeEmailHtml(parts({ postalAddress: "{{firstName}} Road" }), SAMPLE_CONTACT, LINK)).toContain("{{firstName}} Road");
  });
});
