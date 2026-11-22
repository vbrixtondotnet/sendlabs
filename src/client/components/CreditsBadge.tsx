/** MOCKUP: the credit balance is made up until credits are real (a People "Add Contact" reveal will spend 1 each). */
export const MOCK_CREDITS = 100;

/** The balance shown at the right of the top bar, with a coins icon. */
export function CreditsBadge({ credits = MOCK_CREDITS }: { credits?: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
      title="Credits left. Revealing a person's email address on Search People uses 1 credit."
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
        <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
        <path d="M7 6h1v4" />
        <path d="m16.71 13.88.7.71-2.82 2.82" />
      </svg>
      <span>{credits.toLocaleString("en-US")} {credits === 1 ? "Credit" : "Credits"}</span>
    </span>
  );
}
