/** trim + lower-case only. No Gmail-dot or plus-tag rewriting. */
export const normalizeEmail = (e: string): string => e.trim().toLowerCase();

/** Syntax check only. It cannot prove that a mailbox exists. Expects an already normalized address. */
export function isValidEmail(e: string): boolean {
  if (e.length > 254) return false;
  if (!/^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/.test(e)) return false;
  const [local = "", domain = ""] = e.split("@");
  return (
    local.length <= 64 &&
    !local.includes("..") &&
    !domain.includes("..") &&
    !domain.startsWith(".") &&
    !domain.startsWith("-")
  );
}
