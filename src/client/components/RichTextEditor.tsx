import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { isBlankHtml } from "@/lib/merge";
import { MergeFieldHighlight } from "@/components/mergeFieldHighlight";

/**
 * A rich-text editor for email content (body and signature). It holds and returns HTML.
 *
 * What it keeps is what email can show: paragraphs, headings, bold, italic, underline, strikethrough, links, bulleted and
 * numbered lists, quotes, rules and alignment. Anything else in the HTML it is given (tables, scripts, styles, event
 * handlers) is not part of its model and is dropped the first time the content is edited, which is also what makes it
 * safe to load. The "HTML" button switches to the raw source for hand-written markup, which is kept exactly as typed.
 *
 * Empty content is reported as "" (an empty editor holds `<p></p>`), and `{{merge fields}}` are plain text to it, so they
 * survive, including as a link address.
 */
export interface RichTextEditorProps {
  /** The name of the field: the visible label and the accessible name of the editing area. */
  label: string;
  value: string;
  onChange: (html: string) => void;
  hint?: ReactNode;
  /** `{{tags}}` offered as buttons that insert them where the cursor is. */
  tags?: readonly string[];
  /** A shorter toolbar, for small fields such as a signature. */
  compact?: boolean;
  /** Height of the editing area, as Tailwind classes. */
  heightClass?: string;
  /** Gives the editor to the caller (tests use it to select and type). */
  onEditor?: (editor: Editor | null) => void;
}

/** Link addresses may be ordinary ones (http, https, mailto, tel) or a merge field such as {{unsubscribeUrl}}. Never javascript:. */
const isAllowedUri = (url: string | undefined, ctx: { defaultValidate: (url: string) => boolean }) =>
  !!url && (/^\{\{\w+\}\}$/.test(url.trim()) || ctx.defaultValidate(url));

const EXTENSIONS = [
  StarterKit.configure({
    code: false,
    codeBlock: false,
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: false, isAllowedUri },
  }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  MergeFieldHighlight,
];

const toolbarButton = (active: boolean) =>
  `rounded-md px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
    active ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-700"
  }`;

function Btn({ label, active = false, disabled = false, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    // mouse-down is cancelled so pressing a button does not take the cursor (and the selection) out of the text
    <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={toolbarButton(active)}>
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-1 h-5 w-px self-center bg-slate-300 dark:bg-slate-700" />;

export function RichTextEditor({ label, value, onChange, hint, tags, compact = false, heightClass = "min-h-[9rem]", onEditor }: RichTextEditorProps) {
  const [source, setSource] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  /** The last content the editor itself reported, so the sync below can tell "my own change coming back" from "changed elsewhere". */
  const emitted = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: value,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { role: "textbox", "aria-multiline": "true", "aria-label": label, class: `rte-content ${heightClass}` } },
    onUpdate: ({ editor: ed }) => {
      // The editor keeps an empty paragraph after a list, quote or line so there is always somewhere to type. It is not
      // part of the message, and in an email it would only add a gap, so it is not reported.
      const html = ed.getHTML().replace(/(<p(?: [^>]*)?><\/p>)+$/, "");
      const out = isBlankHtml(html) ? "" : html;
      emitted.current = out;
      onChangeRef.current(out);
    },
  });

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  // Content changed from outside (the signature filled in once who you are has loaded, or HTML edited in the source view):
  // show it, without reporting it back as an edit.
  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return null;

  const heading = [1, 2, 3].find((level) => editor.isActive("heading", { level }));
  const canLink = !editor.state.selection.empty || editor.isActive("link");

  function openLink() {
    if (!editor) return;
    setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
    setLinkProblem(null);
    setLinkOpen((o) => !o);
  }

  function applyLink() {
    if (!editor) return;
    const url = linkUrl.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }
    if (!editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()) {
      setLinkProblem("That address cannot be used. Use https://…, mailto:… or a merge field like {{unsubscribeUrl}}.");
      return;
    }
    setLinkProblem(null);
    setLinkOpen(false);
  }

  function insertTag(tag: string) {
    if (!editor) return;
    if (source) {
      const el = sourceRef.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + tag + value.slice(end));
      return;
    }
    editor.chain().focus().insertContent(tag).run();
  }

  const showEditing = !source;

  return (
    <div>
      {tags && tags.length > 0 && (
        // Above the field, so they are the first thing seen. Light yellow, like a warning, to stand out; the same colour
        // marks a merge field once it is in the text.
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Insert:</span>
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertTag(t)}
              className="rounded-md border border-amber-300 bg-amber-100 px-2 py-1 font-mono text-xs text-amber-900 hover:bg-amber-200 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="mb-1 text-sm font-medium">{label}</div>
      {hint && <p className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      <div className="rounded-lg border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900">
        <div role="toolbar" aria-label={`${label} formatting`} className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-800 dark:bg-slate-800/50">
          {showEditing && (
            <>
              {!compact && (
                <select
                  aria-label="Text style"
                  className="mr-1 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  value={heading ? `h${heading}` : "p"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "p") editor.chain().focus().setParagraph().run();
                    else editor.chain().focus().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
                  }}
                >
                  <option value="p">Paragraph</option>
                  <option value="h1">Heading 1</option>
                  <option value="h2">Heading 2</option>
                  <option value="h3">Heading 3</option>
                </select>
              )}
              <Btn label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></Btn>
              <Btn label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></Btn>
              <Btn label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><span className="underline">U</span></Btn>
              <Btn label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><span className="line-through">S</span></Btn>
              <Divider />
              <Btn label="Link" active={editor.isActive("link") || linkOpen} disabled={!canLink && !linkOpen} onClick={openLink}>Link</Btn>
              {!compact && (
                <>
                  <Divider />
                  <Btn label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</Btn>
                  <Btn label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</Btn>
                  <Btn label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>Quote</Btn>
                  <Btn label="Horizontal line" onClick={() => editor.chain().focus().setHorizontalRule().run()}>Line</Btn>
                </>
              )}
              <Divider />
              <Btn label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>Left</Btn>
              <Btn label="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>Center</Btn>
              <Btn label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>Right</Btn>
              <Divider />
              <Btn label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>Clear</Btn>
              <Btn label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>Undo</Btn>
              <Btn label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>Redo</Btn>
            </>
          )}
          <span className="ml-auto" />
          <Btn label="HTML source" active={source} onClick={() => { setLinkOpen(false); setSource((s) => !s); }}>HTML</Btn>
        </div>

        {showEditing && linkOpen && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900">
            <input
              type="text"
              aria-label="Link address"
              placeholder="https://example.com or {{unsubscribeUrl}}"
              value={linkUrl}
              onChange={(e) => { setLinkUrl(e.target.value); setLinkProblem(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }}
              className="min-w-[12rem] flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            <button type="button" onClick={applyLink} className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700">Apply</button>
            <button type="button" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkOpen(false); }} className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-700">Remove link</button>
            {linkProblem && <p role="alert" className="w-full text-xs text-rose-600">{linkProblem}</p>}
          </div>
        )}

        {/* The editor stays mounted (hidden) while the source is shown, so switching back keeps undo history. */}
        <div hidden={!showEditing}>
          <EditorContent editor={editor} />
        </div>
        {source && (
          <textarea
            ref={sourceRef}
            aria-label={label}
            spellCheck={false}
            rows={10}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`block w-full rounded-b-lg bg-white px-3 py-2.5 font-mono text-xs outline-none dark:bg-slate-900 ${heightClass}`}
          />
        )}
      </div>

      {showEditing && !compact && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Formatting the toolbar does not offer is removed when you edit here. Use HTML to keep custom markup.</p>}
    </div>
  );
}
