/**
 * True when the page is being served from this machine (localhost, 127.0.0.1 or ::1). Used only to relax things that exist to protect a
 * deployed app from misuse, so they do not get in the way of trying it out: for now, the Apply panel's To field is typeable here, and
 * Get Email Address (which costs credits and a Hunter search) is not enforced. A deployed site is never on localhost.
 */
export function isLocalhost(): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(window.location.hostname);
  } catch {
    return false;
  }
}
