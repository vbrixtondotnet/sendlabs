/**
 * jsdom has no layout, so it lacks the geometry methods a rich-text editor calls when it scrolls the cursor into view.
 * These give them an empty answer ("nothing is anywhere"), which is all the editor needs to carry on.
 */
const rect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) });
const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () { /* none */ } }) as unknown as DOMRectList;

if (typeof Range !== "undefined") {
  Range.prototype.getBoundingClientRect ??= rect;
  Range.prototype.getClientRects ??= noRects;
}
if (typeof Text !== "undefined") {
  (Text.prototype as unknown as { getClientRects?: () => DOMRectList }).getClientRects ??= noRects;
}
if (typeof Element !== "undefined") {
  Element.prototype.getClientRects ??= noRects;
  Element.prototype.scrollIntoView ??= () => undefined;
}
export {};
