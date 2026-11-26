import type { Role } from "@shared/types";

/**
 * Which parts of the app each kind of account can open. The server enforces the same rules (a forbidden call answers 403); this
 * decides what the menu shows and where a forbidden address sends you.
 *  - SuperAdmin: Email Templates, Global Contacts and User Accounts.
 *  - JobSeeker: Jobs, Summary, Contacts, Search People and My Settings (which holds its Email Settings). No Campaigns, Imports, Email Templates
 *    or Settings page.
 *  - Agency: everything except Jobs.
 */
const EVERYONE_BUT_SUPERADMIN: Role[] = ["JobSeeker", "Agency"];

/** The first path segment ("" for the start page) mapped to the roles that may open it. */
const AREAS: Record<string, Role[]> = {
  "": EVERYONE_BUT_SUPERADMIN,
  imports: ["Agency"],
  contacts: EVERYONE_BUT_SUPERADMIN,
  people: EVERYONE_BUT_SUPERADMIN,
  settings: ["Agency"],
  jobs: ["JobSeeker"],
  campaigns: ["Agency"],
  templates: ["SuperAdmin", "Agency"],
  users: ["SuperAdmin"],
  "global-contacts": ["SuperAdmin"],
  account: ["SuperAdmin", "JobSeeker", "Agency"],
};

export const canOpen = (role: Role, path: string): boolean => {
  const area = path.split("?")[0]!.split("/").filter(Boolean)[0] ?? "";
  const allowed = AREAS[area];
  return allowed ? allowed.includes(role) : true;
};

/**
 * Where an address the account may not open sends it. A JobSeeker has no Settings page: its settings (including the Gmail connection,
 * which Google sends the browser back to as /settings?sender=...) are on My Settings, on the Email Settings tab. Anyone else goes home.
 */
export function redirectFor(role: Role, pathAndSearch: string): string {
  const [path = "", search = ""] = pathAndSearch.split("?");
  if (role === "JobSeeker" && (path === "/settings" || path.startsWith("/settings/"))) {
    const params = new URLSearchParams(search);
    params.set("tab", "email");
    return `/account?${params.toString()}`;
  }
  return homeFor(role);
}

/** Where an account lands: the start page, except a SuperAdmin, who has no start page and lands on Email Templates. */
export const homeFor = (role: Role): string => (role === "SuperAdmin" ? "/templates" : "/");

export const roleLabel: Record<Role, string> = { SuperAdmin: "SuperAdmin", JobSeeker: "JobSeeker", Agency: "Agency" };
