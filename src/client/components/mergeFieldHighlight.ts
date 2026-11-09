import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { MERGE_FIELDS, SIGNATURE_TAG, UNSUBSCRIBE_TAG } from "@/lib/merge";

/** What the page recognises as a merge field. Anything else in double braces is a typo, and is shown as one. */
const KNOWN = new Set<string>([...MERGE_FIELDS.map((f) => f.tag), UNSUBSCRIBE_TAG, SIGNATURE_TAG]);
/** The same pattern the page uses to find unknown merge fields (`unknownTags`). */
const TAG = /\{\{[^}]*\}\}/g;

/**
 * Highlights `{{merge fields}}` in the text, so they stand out from the message around them: light yellow for the ones
 * that will be filled in, red for a typo that will not. It only DECORATES the text on screen: nothing is added to the
 * document, so the HTML the editor reports (and that is saved and sent) is exactly what was written.
 */
export const MergeFieldHighlight = Extension.create({
  name: "mergeFieldHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("mergeFieldHighlight"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const m of node.text.matchAll(TAG)) {
                const from = pos + (m.index ?? 0);
                decorations.push(Decoration.inline(from, from + m[0].length, { class: KNOWN.has(m[0]) ? "merge-tag" : "merge-tag merge-tag-unknown" }));
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
