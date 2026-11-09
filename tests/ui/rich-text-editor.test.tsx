// @vitest-environment jsdom
import { useRef, useState } from "react";
import "./dom-polyfills";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { RichTextEditor, type RichTextEditorProps } from "../../src/client/components/RichTextEditor";

afterEach(cleanup);

/** The editor with a parent that keeps the value, like the campaign form does, and lets a test reach the editor itself. */
function renderEditor(initial = "", props: Partial<RichTextEditorProps> = {}) {
  const changes: string[] = [];
  let editor: Editor | null = null;
  let setOutside: (v: string) => void = () => undefined;
  function Parent() {
    const [value, setValue] = useState(initial);
    setOutside = setValue;
    const ref = useRef<(e: Editor | null) => void>((e) => { editor = e; });
    return <RichTextEditor label="Body" value={value} onChange={(v) => { changes.push(v); setValue(v); }} onEditor={ref.current} {...props} />;
  }
  render(<Parent />);
  return {
    changes,
    editor: () => editor!,
    last: () => changes.at(-1),
    /** Runs an editor command the way typing or a shortcut would. */
    run: (fn: (e: Editor) => void) => act(() => fn(editor!)),
    area: () => screen.getByRole("textbox", { name: "Body" }),
    toolbar: () => within(screen.getByRole("toolbar", { name: "Body formatting" })),
    outside: (v: string) => act(() => setOutside(v)),
  };
}
const press = (t: ReturnType<typeof renderEditor>, name: string) => fireEvent.click(t.toolbar().getByRole("button", { name }));
const isOn = (t: ReturnType<typeof renderEditor>, name: string) => t.toolbar().getByRole("button", { name }).getAttribute("aria-pressed") === "true";
const selectAll = (t: ReturnType<typeof renderEditor>) => t.run((e) => e.commands.selectAll());

describe("RichTextEditor: what it shows", () => {
  it("shows the given HTML as formatted text, in an editable area with an accessible name", () => {
    const t = renderEditor("<p>Hello <strong>bold</strong> and <em>italic</em></p>");
    expect(t.area().getAttribute("contenteditable")).toBe("true");
    expect(t.area().getAttribute("aria-multiline")).toBe("true");
    expect(t.area().querySelector("strong")!.textContent).toBe("bold");
    expect(t.area().querySelector("em")!.textContent).toBe("italic");
    expect(t.area().textContent).toBe("Hello bold and italic");
  });

  it("has a label and a hint", () => {
    renderEditor("", { hint: "Just the message." });
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.getByText("Just the message.")).toBeTruthy();
  });

  it("offers the full toolbar by default", () => {
    const t = renderEditor();
    for (const name of ["Bold", "Italic", "Underline", "Strikethrough", "Link", "Bulleted list", "Numbered list", "Quote", "Horizontal line", "Align left", "Align center", "Align right", "Clear formatting", "Undo", "Redo", "HTML source"]) {
      expect(t.toolbar().getByRole("button", { name }), name).toBeTruthy();
    }
    expect(t.toolbar().getByRole("combobox", { name: "Text style" })).toBeTruthy();
  });

  it("offers a shorter toolbar when compact: no headings, lists, quote or line", () => {
    const t = renderEditor("", { compact: true });
    for (const name of ["Bold", "Italic", "Underline", "Strikethrough", "Link", "Align left", "Align center", "Align right", "Clear formatting", "Undo", "Redo", "HTML source"]) {
      expect(t.toolbar().getByRole("button", { name }), name).toBeTruthy();
    }
    for (const name of ["Bulleted list", "Numbered list", "Quote", "Horizontal line"]) expect(t.toolbar().queryByRole("button", { name }), name).toBeNull();
    expect(t.toolbar().queryByRole("combobox", { name: "Text style" })).toBeNull();
  });

  it("loads {{merge fields}} as ordinary text, including as a link address", () => {
    const t = renderEditor('<p>Hi {{firstName}}, <a href="{{unsubscribeUrl}}">stop</a></p>');
    expect(t.area().textContent).toBe("Hi {{firstName}}, stop");
    expect(t.area().querySelector("a")!.getAttribute("href")).toBe("{{unsubscribeUrl}}");
  });
});

describe("RichTextEditor: formatting", () => {
  it("reports what is typed as HTML", () => {
    const t = renderEditor();
    t.run((e) => e.commands.insertContent("Hello there"));
    expect(t.last()).toBe("<p>Hello there</p>");
  });

  it.each([
    ["Bold", "<strong>"],
    ["Italic", "<em>"],
    ["Underline", "<u>"],
    ["Strikethrough", "<s>"],
  ])("%s: applies to the selection, shows as pressed, and comes off again", (name, tag) => {
    const t = renderEditor("<p>Some words</p>");
    selectAll(t);
    press(t, name);
    expect(t.last()).toContain(tag);
    expect(isOn(t, name)).toBe(true);
    press(t, name);
    expect(t.last()).not.toContain(tag);
    expect(isOn(t, name)).toBe(false);
  });

  it("Text style: makes a heading, and back to a paragraph", () => {
    const t = renderEditor("<p>Title</p>");
    t.run((e) => e.commands.setTextSelection(3)); // the cursor inside the text
    fireEvent.change(t.toolbar().getByRole("combobox", { name: "Text style" }), { target: { value: "h2" } });
    expect(t.last()).toBe("<h2>Title</h2>");
    expect((t.toolbar().getByRole("combobox", { name: "Text style" }) as HTMLSelectElement).value).toBe("h2");
    fireEvent.change(t.toolbar().getByRole("combobox", { name: "Text style" }), { target: { value: "p" } });
    expect(t.last()).toBe("<p>Title</p>");
  });

  it("offers three heading levels", () => {
    const t = renderEditor();
    const options = [...t.toolbar().getByRole("combobox", { name: "Text style" }).querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Paragraph", "Heading 1", "Heading 2", "Heading 3"]);
  });

  it("Bulleted list and Numbered list", () => {
    const t = renderEditor("<p>One</p>");
    t.run((e) => e.commands.setTextSelection(3)); // the cursor inside the text
    press(t, "Bulleted list");
    expect(t.last()).toBe("<ul><li><p>One</p></li></ul>");
    expect(isOn(t, "Bulleted list")).toBe(true);
    press(t, "Numbered list");
    expect(t.last()).toBe("<ol><li><p>One</p></li></ol>");
    press(t, "Numbered list");
    expect(t.last()).toBe("<p>One</p>");
  });

  it("Quote", () => {
    const t = renderEditor("<p>Wise words</p>");
    selectAll(t);
    press(t, "Quote");
    expect(t.last()).toBe("<blockquote><p>Wise words</p></blockquote>");
  });

  it("Horizontal line", () => {
    const t = renderEditor("<p>Above</p>");
    t.run((e) => e.commands.focus("end"));
    press(t, "Horizontal line");
    expect(t.last()).toContain("<hr>");
  });

  it("Alignment", () => {
    const t = renderEditor("<p>Centered</p>");
    selectAll(t);
    press(t, "Align center");
    expect(t.last()).toBe('<p style="text-align: center;">Centered</p>');
    expect(isOn(t, "Align center")).toBe(true);
    press(t, "Align right");
    expect(t.last()).toBe('<p style="text-align: right;">Centered</p>');
  });

  it("Clear formatting removes marks and turns headings and lists back into plain paragraphs", () => {
    const t = renderEditor("<h1><strong>Big</strong> <em>words</em></h1>");
    selectAll(t);
    press(t, "Clear formatting");
    expect(t.last()).toBe("<p>Big words</p>");
  });

  it("Undo and Redo walk back and forward through the changes", () => {
    const t = renderEditor();
    expect((t.toolbar().getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
    t.run((e) => e.commands.insertContent("First"));
    expect((t.toolbar().getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(false);
    press(t, "Undo");
    expect(t.last()).toBe(""); // back to empty
    expect((t.toolbar().getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(false);
    press(t, "Redo");
    expect(t.last()).toBe("<p>First</p>");
  });

  it("reports empty content as an empty string, never <p></p>", () => {
    const t = renderEditor("<p>Something</p>");
    selectAll(t);
    t.run((e) => e.commands.deleteSelection());
    expect(t.last()).toBe("");
    t.run((e) => e.commands.insertContent("   "));
    expect(t.last()).toBe(""); // only spaces is still nothing
  });

  it("does not report a change just for being shown", () => {
    const t = renderEditor("<p>Untouched</p>");
    expect(t.changes).toEqual([]);
  });
});

describe("RichTextEditor: links", () => {
  const linkInput = () => screen.getByRole("textbox", { name: "Link address" }) as HTMLInputElement;
  const withSelection = () => {
    const t = renderEditor("<p>Visit us</p>");
    selectAll(t);
    press(t, "Link");
    return t;
  };

  it("cannot be started with nothing selected", () => {
    const t = renderEditor("<p>Visit us</p>");
    expect((t.toolbar().getByRole("button", { name: "Link" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("links the selected text to an address", () => {
    const t = withSelection();
    fireEvent.change(linkInput(), { target: { value: "https://example.com/about" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(t.last()).toContain('<a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/about">Visit us</a>');
    expect(screen.queryByRole("textbox", { name: "Link address" })).toBeNull(); // closed
  });

  it("applies on Enter", () => {
    const t = withSelection();
    fireEvent.change(linkInput(), { target: { value: "mailto:hello@example.com" } });
    fireEvent.keyDown(linkInput(), { key: "Enter" });
    expect(t.last()).toContain('href="mailto:hello@example.com"');
  });

  it("accepts a merge field as the address, so the unsubscribe link can be made", () => {
    const t = withSelection();
    fireEvent.change(linkInput(), { target: { value: "{{unsubscribeUrl}}" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(t.last()).toContain('href="{{unsubscribeUrl}}"');
  });

  it("refuses a javascript: address, says so, and makes no link", () => {
    const t = withSelection();
    fireEvent.change(linkInput(), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert").textContent).toMatch(/cannot be used/);
    expect(t.last()).toBeUndefined();
    expect(t.area().querySelector("a")).toBeNull();
    expect(linkInput().value).toBe("javascript:alert(1)"); // still there to fix
  });

  it("shows the current address when the cursor is in a link, and changes it", () => {
    const t = renderEditor('<p><a href="https://old.test">Visit</a> us</p>');
    t.run((e) => e.commands.setTextSelection(3));
    press(t, "Link");
    expect(linkInput().value).toBe("https://old.test");
    fireEvent.change(linkInput(), { target: { value: "https://new.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(t.last()).toContain('href="https://new.test"');
    expect(t.last()).not.toContain("old.test");
  });

  it("removes a link with the Remove link button", () => {
    const t = renderEditor('<p><a href="https://old.test">Visit</a> us</p>');
    t.run((e) => e.commands.setTextSelection(3));
    press(t, "Link");
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    expect(t.last()).toBe("<p>Visit us</p>");

  });

  it("empty address removes the link", () => {
    const t = renderEditor('<p><a href="https://old.test">Visit</a> us</p>');
    t.run((e) => e.commands.setTextSelection(3));
    press(t, "Link");
    fireEvent.change(linkInput(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(t.last()).toBe("<p>Visit us</p>");
  });
});

describe("RichTextEditor: what comes from outside", () => {
  it("shows a new value set by the page (such as the signature filled in once who you are has loaded), without calling that an edit", () => {
    const t = renderEditor("");
    t.outside("<p>Best regards,<br/>Rico</p>");
    expect(t.area().textContent).toBe("Best regardsRico".replace("Best regardsRico", "Best regards,Rico"));
    expect(t.area().querySelectorAll("br").length).toBeGreaterThan(0);
    expect(t.changes).toEqual([]);
  });

  it("does not loop: the page handing back what the editor just reported changes nothing", () => {
    const t = renderEditor("<p>A</p>");
    t.run((e) => e.commands.focus("end"));
    t.run((e) => e.commands.insertContent("B"));
    t.run((e) => e.commands.insertContent("C"));
    expect(t.changes).toEqual(["<p>AB</p>", "<p>ABC</p>"]);
  });

  it("keeps what is being typed when the page re-renders with the same value", () => {
    const t = renderEditor("<p>A</p>");
    t.run((e) => e.commands.focus("end"));
    t.run((e) => e.commands.insertContent("B"));
    t.outside(t.last()!);
    expect(t.area().textContent).toBe("AB");
  });

  it("can be emptied from outside", () => {
    const t = renderEditor("<p>Something</p>");
    t.outside("");
    expect(t.area().textContent).toBe("");
  });
});

describe("RichTextEditor: the HTML source view", () => {
  const sourceBox = () => screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement;

  it("shows the exact HTML in a text box, hides the formatting buttons, and goes back", () => {
    const t = renderEditor("<p>Hi <strong>there</strong></p>");
    press(t, "HTML source");
    expect(sourceBox().tagName).toBe("TEXTAREA");
    expect(sourceBox().value).toBe("<p>Hi <strong>there</strong></p>");
    expect(isOn(t, "HTML source")).toBe(true);
    expect(t.toolbar().queryByRole("button", { name: "Bold" })).toBeNull();
    press(t, "HTML source");
    expect(screen.getByRole("textbox", { name: "Body" }).tagName).toBe("DIV");
    expect(t.toolbar().getByRole("button", { name: "Bold" })).toBeTruthy();
  });

  it("keeps what is typed there exactly as typed, markup the toolbar does not offer included", () => {
    const t = renderEditor("");
    press(t, "HTML source");
    const custom = '<table><tr><td style="color:red">Cell</td></tr></table>';
    fireEvent.change(sourceBox(), { target: { value: custom } });
    expect(t.last()).toBe(custom);
    expect(sourceBox().value).toBe(custom);
  });

  it("shows what was typed in the source in the editing area when switching back", () => {
    const t = renderEditor("");
    press(t, "HTML source");
    fireEvent.change(sourceBox(), { target: { value: "<p>From <em>source</em></p>" } });
    press(t, "HTML source");
    expect(t.area().querySelector("em")!.textContent).toBe("source");
  });

  it("shows what was done in the editor in the source", () => {
    const t = renderEditor("<p>Words</p>");
    selectAll(t);
    press(t, "Bold");
    press(t, "HTML source");
    expect(sourceBox().value).toBe("<p><strong>Words</strong></p>");
  });

  it("closes the link box when it is opened", () => {
    const t = renderEditor("<p>Visit</p>");
    selectAll(t);
    press(t, "Link");
    expect(screen.getByRole("textbox", { name: "Link address" })).toBeTruthy();
    press(t, "HTML source");
    expect(screen.queryByRole("textbox", { name: "Link address" })).toBeNull();
  });
});

describe("RichTextEditor: merge field buttons", () => {
  const TAGS = ["{{firstName}}", "{{companyName}}"] as const;

  it("lists them, and inserts the one pressed where the cursor is", () => {
    const t = renderEditor("<p>Hi , welcome</p>", { tags: TAGS });
    expect(screen.getByText("Insert:")).toBeTruthy();
    t.run((e) => e.commands.setTextSelection(4)); // after "Hi "
    fireEvent.click(screen.getByRole("button", { name: "{{firstName}}" }));
    expect(t.last()).toBe("<p>Hi {{firstName}}, welcome</p>");
  });

  it("replaces a selection with the tag", () => {
    const t = renderEditor("<p>Dear NAME</p>", { tags: TAGS });
    t.run((e) => e.commands.setTextSelection({ from: 6, to: 10 }));
    fireEvent.click(screen.getByRole("button", { name: "{{companyName}}" }));
    expect(t.last()).toBe("<p>Dear {{companyName}}</p>");
  });

  it("does not take the cursor out of the text when pressed (mouse-down is cancelled)", () => {
    renderEditor("<p>x</p>", { tags: TAGS });
    const button = screen.getByRole("button", { name: "{{firstName}}" });
    expect(fireEvent.mouseDown(button)).toBe(false); // preventDefault was called
  });

  it("inserts into the source view, at the caret, when that is showing", () => {
    const t = renderEditor("<p>Hi </p>", { tags: TAGS });
    press(t, "HTML source");
    const box = screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement;
    box.setSelectionRange(6, 6); // after "<p>Hi "
    fireEvent.click(screen.getByRole("button", { name: "{{firstName}}" }));
    expect(t.last()).toBe("<p>Hi {{firstName}}</p>");
  });

  it("shows no Insert row when there are no tags", () => {
    renderEditor("");
    expect(screen.queryByText("Insert:")).toBeNull();
  });
});

describe("RichTextEditor: unsupported and unsafe markup", () => {
  it("does not load scripts, event handlers, tables or styles into the editing area", () => {
    const t = renderEditor('<script>window.hacked = 1</script><p onclick="window.hacked = 2" style="color:red">Hi</p><table><tr><td>Cell</td></tr></table><iframe src="https://evil.test"></iframe><img src="x" onerror="window.hacked = 3">');
    const html = t.area().innerHTML;
    for (const bad of ["<script", "onclick", "onerror", "<table", "<iframe", "<img", "color:red"]) expect(html, bad).not.toContain(bad);
    expect(t.area().textContent).toContain("Hi");
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it("drops them from what it reports as soon as the content is edited", () => {
    const t = renderEditor('<p onclick="x()">Hi</p><script>alert(1)</script>');
    t.run((e) => e.commands.focus("end"));
    t.run((e) => e.commands.insertContent("!"));
    expect(t.last()).toBe("<p>Hi!</p>");
  });

  it("does not make a javascript: link from loaded HTML either", () => {
    const t = renderEditor('<p><a href="javascript:alert(1)">click</a></p>');
    const a = t.area().querySelector("a");
    expect(a?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });

  it("says, under the editor, that formatting the toolbar does not offer is removed on editing, and where to keep it", () => {
    renderEditor("");
    expect(screen.getByText(/Formatting the toolbar does not offer is removed when you edit here\. Use HTML to keep custom markup\./)).toBeTruthy();
  });

  it("leaves that note out of a compact editor", () => {
    renderEditor("", { compact: true });
    expect(screen.queryByText(/Use HTML to keep custom markup/)).toBeNull();
  });
});

describe("RichTextEditor: pressing a button keeps the cursor in the text", () => {
  it("cancels mouse-down on every toolbar button, so the selection survives", () => {
    const t = renderEditor("<p>x</p>");
    for (const button of t.toolbar().getAllByRole("button") as HTMLButtonElement[]) {
      if (button.disabled) continue; // a disabled button cannot be pressed at all
      expect(fireEvent.mouseDown(button), button.getAttribute("aria-label") ?? "").toBe(false);
    }
  });

  it("calls the editor callback with the editor, and with null when it goes away", () => {
    const seen = vi.fn();
    const { unmount } = render(<RichTextEditor label="Body" value="" onChange={() => undefined} onEditor={seen} />);
    expect(seen.mock.calls.some(([e]) => e && typeof e.getHTML === "function")).toBe(true);
    unmount();
    expect(seen.mock.calls.at(-1)![0]).toBeNull();
  });
});

describe("RichTextEditor: merge fields stand out", () => {
  const TAGS = ["{{firstName}}", "{{companyName}}"] as const;
  const marked = (t: ReturnType<typeof renderEditor>, cls = ".merge-tag") => [...t.area().querySelectorAll(cls)].map((el) => el.textContent);

  it("puts the Insert row above the field: first the buttons, then the label, then the editor", () => {
    const t = renderEditor("", { tags: TAGS });
    const insert = screen.getByText("Insert:");
    const label = screen.getByText("Body");
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(insert.compareDocumentPosition(label) & FOLLOWING).toBeTruthy();
    expect(label.compareDocumentPosition(t.toolbar().getByRole("button", { name: "Bold" })) & FOLLOWING).toBeTruthy();
    expect(insert.compareDocumentPosition(t.area()) & FOLLOWING).toBeTruthy();
  });

  it("makes every merge-field button light yellow, like a warning", () => {
    renderEditor("", { tags: TAGS });
    for (const tag of TAGS) {
      const button = screen.getByRole("button", { name: tag });
      expect(button.className, tag).toContain("bg-amber-100");
      expect(button.className, tag).toContain("border-amber-300");
      expect(button.className, tag).toContain("text-amber-900");
    }
  });

  it("highlights merge fields that are already in the text, in the same yellow family", () => {
    const t = renderEditor("<p>Hi {{firstName}}, welcome to {{companyName}}. <a href=\"{{unsubscribeUrl}}\">{{unsubscribeUrl}}</a></p>", { tags: TAGS });
    expect(marked(t)).toEqual(["{{firstName}}", "{{companyName}}", "{{unsubscribeUrl}}"]);
    expect(marked(t, ".merge-tag-unknown")).toEqual([]);
  });

  it("marks one that will not be filled in (a typo) differently, so it is noticed", () => {
    const t = renderEditor("<p>Hi {{firstName}} and {{frstName}}</p>");
    expect(marked(t, ".merge-tag:not(.merge-tag-unknown)")).toEqual(["{{firstName}}"]);
    expect(marked(t, ".merge-tag-unknown")).toEqual(["{{frstName}}"]);
  });

  it("highlights one as soon as it is inserted with a button, and it stays in the right place", () => {
    const t = renderEditor("<p>Hi , welcome</p>", { tags: TAGS });
    expect(marked(t)).toEqual([]);
    t.run((e) => e.commands.setTextSelection(4));
    fireEvent.click(screen.getByRole("button", { name: "{{firstName}}" }));
    expect(marked(t)).toEqual(["{{firstName}}"]);
    expect(t.area().querySelector(".merge-tag")!.previousSibling!.textContent).toBe("Hi ");
    expect(t.area().querySelector(".merge-tag")!.nextSibling!.textContent).toBe(", welcome");
  });

  it("highlights one that is typed out, and stops when it is broken", () => {
    const t = renderEditor("<p>Hi </p>");
    t.run((e) => e.commands.focus("end"));
    t.run((e) => e.commands.insertContent("{{title}}"));
    expect(marked(t)).toEqual(["{{title}}"]);
    t.run((e) => e.commands.setTextSelection(t.editor().state.doc.content.size - 2)); // inside the closing braces
    t.run((e) => e.commands.deleteRange({ from: t.editor().state.selection.from - 1, to: t.editor().state.selection.from }));
    expect(marked(t)).toEqual([]);
  });

  it("keeps the highlight through bold, and in more than one paragraph", () => {
    const t = renderEditor("<p>{{firstName}}</p><p>and <strong>{{lastName}}</strong></p>");
    expect(marked(t)).toEqual(["{{firstName}}", "{{lastName}}"]);
  });

  it("highlights in the compact signature editor too, which has no buttons of its own", () => {
    const t = renderEditor("<p>Best, {{firstName}}</p>", { compact: true });
    expect(marked(t)).toEqual(["{{firstName}}"]);
    expect(screen.queryByText("Insert:")).toBeNull();
  });

  it("is only how the text looks: nothing is added to the HTML that is reported or saved", () => {
    const t = renderEditor("<p>Hi {{firstName}}</p>", { tags: TAGS });
    t.run((e) => e.commands.focus("end"));
    t.run((e) => e.commands.insertContent(" {{companyName}} and {{nope}}"));
    expect(t.last()).toBe("<p>Hi {{firstName}} {{companyName}} and {{nope}}</p>");
    expect(t.last()).not.toContain("merge-tag");
    expect(t.last()).not.toContain("<span");
    expect(t.editor().getHTML()).not.toContain("merge-tag");
  });

  it("shows plain text in the HTML source view, with no highlighting", () => {
    const t = renderEditor("<p>Hi {{firstName}}</p>", { tags: TAGS });
    fireEvent.click(t.toolbar().getByRole("button", { name: "HTML source" }));
    expect(document.querySelector(".merge-tag")!.closest("[hidden]")).not.toBeNull(); // only in the editing area, which is hidden now
    expect((screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement).value).toBe("<p>Hi {{firstName}}</p>");
  });

  it("highlights across text the page sets from outside, such as a signature filled in later", () => {
    const t = renderEditor("");
    t.outside("<p>Hello {{firstName}}</p>");
    expect(marked(t)).toEqual(["{{firstName}}"]);
  });
});
