import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * A dropdown that lets you pick several options and search them by typing. Selected options show as removable chips.
 * Keyboard: type to filter, Up/Down to move, Enter to toggle, Escape to close, Backspace on an empty box removes the last chip.
 */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "Search...",
}: {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const listId = `${id}-list`;

  const shown = useMemo(() => {
    const t = text.trim().toLowerCase();
    return t ? options.filter((o) => o.toLowerCase().includes(t)) : options;
  }, [options, text]);

  // Close when the user clicks anywhere else.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault(); // never submits the surrounding form
      const o = shown[active];
      if (open && o) toggle(o);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && text === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div ref={root} className="relative">
      <label htmlFor={`${id}-input`} className="mb-1 block text-sm font-medium">{label}</label>
      <div
        className="flex min-h-[2.375rem] flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 focus-within:ring-2 focus-within:ring-brand-500 dark:border-slate-700 dark:bg-slate-900"
        onClick={() => setOpen(true)}
      >
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            {v}
            <button type="button" aria-label={`Remove ${v}`} className="rounded text-brand-700/70 hover:text-brand-900 dark:text-brand-300" onClick={(e) => { e.stopPropagation(); toggle(v); }}>
              ×
            </button>
          </span>
        ))}
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          className="min-w-[6rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-slate-400"
          placeholder={value.length === 0 ? placeholder : ""}
          value={text}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setText(e.target.value); setActive(0); setOpen(true); }}
          onKeyDown={onKey}
        />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {shown.length === 0 && <li className="px-3 py-2 text-slate-500">No match</li>}
          {shown.map((o, i) => {
            const selected = value.includes(o);
            return (
              <li
                key={o}
                role="option"
                aria-selected={selected}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${i === active ? "bg-slate-100 dark:bg-slate-800" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault() /* keep focus in the box */}
                onClick={() => toggle(o)}
              >
                <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                  {selected ? "✓" : ""}
                </span>
                {o}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
