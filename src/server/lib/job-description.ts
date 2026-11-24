import type { JobDescriptionBlock } from "../../shared/api";

/**
 * A job's description arrives as HTML from outside (Remotive: HTML with enormous inline styles; Arbeitnow: HTML that is itself
 * escaped as text). It is never passed on as markup. It is read here into plain structured text, headings, paragraphs and lists,
 * and the page draws those with ordinary elements: nothing in it can run, restyle the page, load anything or link anywhere, and a
 * description shrinks from tens of kilobytes to a few.
 */

/** The most text kept per description. Longer ones are cut, with a closing "…". */
export const MAX_DESCRIPTION_CHARS = 15_000;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£",
};

/** `&amp;` `&#39;` `&#x27;` to the characters they stand for. Unknown names are left as they are. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,8});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1]!.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** Whitespace (including no-break and zero-width spaces) collapsed to single spaces. */
// eslint-disable-next-line no-control-regex
const tidy = (t: string): string => decodeEntities(t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‍﻿]/g, "").replace(/[\s ]+/g, " ").trim();

const HEADING = /^h[1-6]$/;
const BREAKS = new Set(["p", "div", "section", "article", "blockquote", "tr", "table", "hr", "header", "footer", "pre"]);

/**
 * Reads a description's HTML into blocks. Tags are only used to find where headings, paragraphs and list items start and end; their
 * attributes and every other tag are dropped, and `script` / `style` content and comments are removed outright.
 */
export function toDescriptionBlocks(input: string | null | undefined, maxChars: number = MAX_DESCRIPTION_CHARS): JobDescriptionBlock[] {
  let html = input ?? "";
  // Arbeitnow sends many descriptions with the markup escaped ("&lt;p&gt;..."), some of them with a stray real tag or two among it.
  // Whichever kind of tag there is more of is what the text is: if it is the escaped kind, unescape once, and it is HTML.
  const real = (html.match(/<\/?[a-z][^<>]*>/gi) ?? []).length;
  const escaped = (html.match(/&lt;\/?[a-z][\s\S]{0,300}?&gt;/gi) ?? []).length;
  if (escaped > real) html = decodeEntities(html);
  html = html.replace(/<(script|style|head|template)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");

  const blocks: JobDescriptionBlock[] = [];
  let used = 0;
  let truncated = false;
  const room = () => !truncated && used < maxChars;
  const push = (block: JobDescriptionBlock, size: number) => {
    if (!room()) { truncated = true; return; }
    blocks.push(block);
    used += size;
  };

  let buf = "";
  let heading = false;
  let list: { ordered: boolean; items: string[] } | null = null;
  let item = false;

  const flushItem = () => {
    if (!item) return;
    const t = tidy(buf);
    buf = "";
    item = false;
    if (t && list) list.items.push(t);
  };
  const flushList = () => {
    flushItem();
    if (list && list.items.length > 0) push({ type: "list", ordered: list.ordered, items: list.items }, list.items.reduce((n, i) => n + i.length, 0));
    list = null;
  };
  const flushText = () => {
    if (item) return; // text inside a list item belongs to the item
    const t = tidy(buf);
    buf = "";
    if (t) push(heading ? { type: "heading", text: t } : { type: "paragraph", text: t }, t.length);
  };

  const tag = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let last = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    buf += html.slice(last, m.index);
    last = m.index + m[0].length;
    const name = m[1]!.toLowerCase();
    const closing = m[0][1] === "/";
    if (name === "br") { if (item) buf += " "; else flushText(); continue; }
    if (HEADING.test(name)) { flushText(); heading = !closing; continue; }
    if (name === "ul" || name === "ol") {
      if (closing) flushList();
      else { flushText(); flushList(); list = { ordered: name === "ol", items: [] }; }
      continue;
    }
    if (name === "li") {
      if (closing) flushItem();
      else { flushItem(); flushText(); if (!list) list = { ordered: false, items: [] }; item = true; }
      continue;
    }
    if (BREAKS.has(name)) { if (item) buf += " "; else flushText(); }
    // any other tag (strong, a, span, ...): ignored, its text stays
  }
  buf += html.slice(last).replace(/<[^>]*$/, ""); // a tag cut off at the very end is not text
  flushList();
  flushText();
  if (truncated) blocks.push({ type: "paragraph", text: "…" });
  return blocks;
}
