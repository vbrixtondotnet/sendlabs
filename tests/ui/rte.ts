import { fireEvent, screen, within } from "@testing-library/react";

/**
 * Drives a rich-text field (components/RichTextEditor.tsx) from a test, through its "HTML" source view: a plain textarea
 * holding exactly the value the page keeps. Typing into a real editing area is the editor library's business, and the
 * page's business is what it does with the HTML that comes out, which is what these helpers set and read.
 */
export function rte(label: string) {
  const toolbar = () => screen.getByRole("toolbar", { name: `${label} formatting` });
  const sourceButton = () => within(toolbar()).getByRole("button", { name: "HTML source" });
  /** Shows the source view (if it is not already shown) and returns its textarea. */
  const source = () => {
    if (sourceButton().getAttribute("aria-pressed") !== "true") fireEvent.click(sourceButton());
    return screen.getByRole("textbox", { name: label }) as HTMLTextAreaElement;
  };
  return {
    toolbar,
    /** Whether the field is on the page at all. */
    exists: () => screen.queryByRole("toolbar", { name: `${label} formatting` }) !== null,
    /** The editing area (not the source view). */
    area: () => screen.getByRole("textbox", { name: label }) as HTMLElement,
    /** The HTML the page holds for this field. */
    value: () => source().value,
    /** Replaces the HTML, as typing it in the source view would. */
    set: (html: string) => { fireEvent.change(source(), { target: { value: html } }); },
  };
}
