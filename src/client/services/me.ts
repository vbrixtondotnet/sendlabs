import { useQuery } from "@tanstack/react-query";
import type { MeDto } from "@shared/api";
import { api } from "./http";

/** The signed-in user and their tenant. Fetched once and kept: it only changes on sign-in. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeDto>("GET", "/api/me"),
    staleTime: 5 * 60_000,
  });
}

/** `Sabertooth Software Labs` -> `SS`; falls back to the email's first letters. Two characters at most. */
export function initialsOf(name: string, email: string): string {
  const words = (name || email.split("@")[0] || "?").split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "") : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
