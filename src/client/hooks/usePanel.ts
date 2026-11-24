import { useCallback, useState } from "react";

/**
 * The state every SlidePanel host needs: what the panel is about, and whether it is open. `show(item)` opens it; `close()` starts
 * the slide-out; the item is forgotten only when the panel has finished sliding out (`onExited`), so the content does not vanish
 * mid-animation. Render the panel while `item` is set, passing `open`, `onClose={close}` and `onExited`.
 */
export function usePanel<T>() {
  const [item, setItem] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  // Changes every time the panel is opened, so one reopened while still sliding out starts fresh (use it in the panel's `key`).
  const [nonce, setNonce] = useState(0);
  const show = useCallback((next: T) => { setItem(next); setOpen(true); setNonce((n) => n + 1); }, []);
  const close = useCallback(() => setOpen(false), []);
  const onExited = useCallback(() => setItem(null), []);
  return { item, open, nonce, show, close, onExited };
}
