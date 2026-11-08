/** Password rules, shared by the server (authoritative) and the UI (early feedback). Length only: no "complexity" guessing. */
export const PASSWORD_MIN_LENGTH = 8;
/** Bounds the work and memory a single request can ask for. */
export const PASSWORD_MAX_LENGTH = 256;

/** Why a password is not acceptable, or null if it is. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters`;
  return null;
}
