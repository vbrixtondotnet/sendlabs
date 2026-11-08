import { useMutation } from "@tanstack/react-query";
import { api } from "./http";

export interface LoginResult {
  redirectTo: string;
  mustChangePassword: boolean;
}

/** Email and password. On success the server sets the session cookie; the caller then loads the app fresh. */
export function useLogin() {
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api<LoginResult>("POST", "/api/auth/login", input),
  });
}

/** Signs out: ends the session and clears the cookie. */
export function useSignOut() {
  return useMutation({ mutationFn: () => api<void>("POST", "/api/auth/logout") });
}

/**
 * Where to go after signing in. Only a path inside this app is honored (never another site, never the login page
 * itself), so a crafted `?next=` link cannot send someone elsewhere.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/invite/")) return "/";
  return raw;
}
