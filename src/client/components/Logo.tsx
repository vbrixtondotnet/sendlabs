import wordmark from "@/assets/logo-wordmark.png";

/**
 * The Sendrix logo (icon and name), trimmed from src/client/assets/logo.png. The artwork has a navy name, which would
 * vanish on a dark background, so in dark mode it sits on a small white plate. Size it with `className` (a height).
 */
export function Logo({ className = "h-8" }: { className?: string }) {
  return <img src={wordmark} alt="Sendrix" className={`w-auto select-none ${className} dark:rounded-md dark:bg-white dark:px-2 dark:py-1`} draggable={false} />;
}
