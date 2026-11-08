import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE = "sendrix_session";
/**
 * How long a session stays valid without being used: 30 days. It slides: every time the app is used, the 30 days start
 * again (see SESSION_RENEW_AFTER_MS), so someone who opens the app at least once a month stays signed in, even after
 * closing the browser. Someone who does not use it for 30 days has to sign in again.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Renewal is written at most this often per session, so a busy page does not write to the database on every request.
 * The cost is that a session can end up to this much sooner than 30 days after its LAST use.
 */
export const SESSION_RENEW_AFTER_MS = 60 * 60 * 1000;

const isHttps = (appBaseUrl: string | undefined) => (appBaseUrl ?? "").startsWith("https:");

/**
 * The session cookie: unreadable by page scripts (HttpOnly), not sent on cross-site POSTs (SameSite=Lax, which is
 * also the main CSRF defence), and marked Secure whenever the app is served over https.
 */
export function setSessionCookie(c: Context, token: string, expiresAtMs: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: isHttps((c.env as { APP_BASE_URL?: string }).APP_BASE_URL),
    expires: new Date(expiresAtMs),
    maxAge: Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000)),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isHttps((c.env as { APP_BASE_URL?: string }).APP_BASE_URL) });
}

export const readSessionCookie = (c: Context): string | undefined => getCookie(c, SESSION_COOKIE);
