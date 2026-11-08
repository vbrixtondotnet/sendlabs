/**
 * Leaves the app for another address, such as Google's consent screen. A function of its own so a test can
 * observe where the browser was sent without actually navigating.
 */
export function goTo(url: string): void {
  window.location.assign(url);
}
