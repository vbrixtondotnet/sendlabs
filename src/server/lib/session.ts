import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE = "sendlab_session";
/** How long a sign-in lasts. There is no sliding renewal yet. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

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
