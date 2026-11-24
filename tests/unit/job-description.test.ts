import { describe, expect, it } from "vitest";
import { MAX_DESCRIPTION_CHARS, decodeEntities, toDescriptionBlocks } from "../../src/server/lib/job-description";

describe("decodeEntities", () => {
  it("decodes named and numeric entities, and leaves what it does not know", () => {
    expect(decodeEntities("Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;x&#39; &#x27;y&#x27; &nbsp;z &ndash; &hellip; &euro;")).toBe("Tom & Jerry <3 \"hi\" 'x' 'y'  z – … €");
    expect(decodeEntities("&unknownthing; &#1114112; &#xD800;")).toBe("&unknownthing;  ");
  });
});

describe("toDescriptionBlocks", () => {
  it("reads headings, paragraphs and lists, and drops every tag and attribute", () => {
    const html = '<h2 style="color:red">About the role</h2><p class="x"><strong>We</strong> build <a href="https://evil.example" onclick="steal()">things</a>.</p><ul><li>React</li><li>Node &amp; SQL</li></ul><ol><li>Apply</li><li>Interview</li></ol><p>Thanks</p>';
    expect(toDescriptionBlocks(html)).toEqual([
      { type: "heading", text: "About the role" },
      { type: "paragraph", text: "We build things." },
      { type: "list", ordered: false, items: ["React", "Node & SQL"] },
      { type: "list", ordered: true, items: ["Apply", "Interview"] },
      { type: "paragraph", text: "Thanks" },
    ]);
  });

  it("removes scripts, styles, comments and template content outright, and never produces markup", () => {
    const blocks = toDescriptionBlocks('<p>Safe</p><script>alert("x")</script><style>p{display:none}</style><!-- secret --><template><b>t</b></template><img src=x onerror=alert(1)><p>&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(blocks).toEqual([{ type: "paragraph", text: "Safe" }, { type: "paragraph", text: "<img src=x onerror=alert(1)>" }]);
    // the second one is TEXT that looks like a tag: the page draws it as characters, so it cannot run
    expect(JSON.stringify(toDescriptionBlocks('<script>alert(1)</script>hello'))).not.toMatch(/script|alert/);
  });

  it("reads Arbeitnow's escaped HTML as HTML", () => {
    const escaped = "&lt;p&gt;&lt;strong&gt;This role&lt;/strong&gt; is in Munich.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;German&lt;/li&gt;&lt;li&gt;English&lt;/li&gt;&lt;/ul&gt;";
    expect(toDescriptionBlocks(escaped)).toEqual([{ type: "paragraph", text: "This role is in Munich." }, { type: "list", ordered: false, items: ["German", "English"] }]);
  });

  it("reads escaped HTML even when a stray real tag sits among it (most of Arbeitnow's), and a double-escaped entity inside", () => {
    const mixed = "&lt;div class=&quot;intro&quot;&gt;&lt;p&gt;We make &lt;strong&gt;great&lt;/strong&gt; things.&lt;/p&gt;&lt;/div&gt;&lt;p&gt;&amp;nbsp;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;P&amp;amp;L&lt;/li&gt;&lt;li&gt;Audit&lt;/li&gt;&lt;/ul&gt;<br />";
    expect(toDescriptionBlocks(mixed)).toEqual([{ type: "paragraph", text: "We make great things." }, { type: "list", ordered: false, items: ["P&L", "Audit"] }]);
    // real markup that merely mentions an escaped tag in its text is still read as real markup
    expect(toDescriptionBlocks("<p>Use &lt;b&gt; for bold</p><p>Second</p>")).toEqual([{ type: "paragraph", text: "Use <b> for bold" }, { type: "paragraph", text: "Second" }]);
  });

  it("splits at line breaks and block elements, collapses whitespace, and keeps text with no tags", () => {
    expect(toDescriptionBlocks("One<br>Two<br/><div>Three</div>   spaced \n\n out")).toEqual([
      { type: "paragraph", text: "One" }, { type: "paragraph", text: "Two" }, { type: "paragraph", text: "Three" }, { type: "paragraph", text: "spaced out" },
    ]);
    expect(toDescriptionBlocks("Just some plain text.")).toEqual([{ type: "paragraph", text: "Just some plain text." }]);
  });

  it("copes with a list item with no list, nested markup in an item, and a line break inside an item", () => {
    expect(toDescriptionBlocks("<li>Alone</li>")).toEqual([{ type: "list", ordered: false, items: ["Alone"] }]);
    expect(toDescriptionBlocks("<ul><li><p>Para <b>bold</b></p><br>more</li></ul>")).toEqual([{ type: "list", ordered: false, items: ["Para bold more"] }]);
  });

  it("is empty for nothing, for only tags, and for broken or cut-off markup", () => {
    expect(toDescriptionBlocks(null)).toEqual([]);
    expect(toDescriptionBlocks("")).toEqual([]);
    expect(toDescriptionBlocks("<div><p></p><ul></ul></div>")).toEqual([]);
    expect(toDescriptionBlocks("Hello <b")).toEqual([{ type: "paragraph", text: "Hello" }]);
    expect(toDescriptionBlocks("<p>Unclosed <b>bold")).toEqual([{ type: "paragraph", text: "Unclosed bold" }]);
  });

  it("shrinks Remotive's huge inline styles to a few KB, and cuts a very long description with a closing ellipsis", () => {
    const styled = `<p style="${"--tw-border-spacing-x: 0; ".repeat(2000)}">Short text</p>`;
    expect(JSON.stringify(toDescriptionBlocks(styled)).length).toBeLessThan(100);
    const long = Array.from({ length: 400 }, (_, i) => `<p>${"word ".repeat(40)}${i}</p>`).join("");
    const blocks = toDescriptionBlocks(long);
    const size = blocks.reduce((n, b) => n + (b.type === "list" ? b.items.join("").length : b.text.length), 0);
    expect(size).toBeLessThan(MAX_DESCRIPTION_CHARS + 500);
    expect(blocks.at(-1)).toEqual({ type: "paragraph", text: "…" });
  });
});
