import type { Role } from "@shared/types";

/**
 * Which parts of the app each kind of account can open. The server enforces the same rules (a forbidden call answers 403); this
 * decides what the menu shows and where a forbidden address sends you.
 *  - SuperAdmin: Email Templates, Global Contacts and User Accounts.
 *  - JobSeeker: everything except Campaigns.
 *  - Agency: everything except Jobs.
 */
const EVERYONE_BUT_SUPERADMIN: Role[] = ["JobSeeker", "Agency"];

/** The first path segment ("" for the start page) mapped to the roles that may open it. */
const AREAS: Record<string, Role[]> = {
  "": EVERYONE_BUT_SUPERADMIN,
  imports: EVERYONE_BUT_SUPERADMIN,
  contacts: EVERYONE_BUT_SUPERADMIN,
  people: EVERYONE_BUT_SUPERADMIN,
  settings: EVERYONE_BUT_SUPERADMIN,
  jobs: ["JobSeeker"],
  campaigns: ["Agency"],
  templates: ["SuperAdmin", "JobSeeker", "Agency"],
  users: ["SuperAdmin"],
  "global-contacts": ["SuperAdmin"],
  account: ["SuperAdmin", "JobSeeker", "Agency"],
};

export const canOpen = (role: Role, path: string): boolean => {
  const area = path.split("?")[0]!.split("/").filter(Boolean)[0] ?? "";
  const allowed = AREAS[area];
  return allowed ? allowed.includes(role) : true;
};

/** Where an account lands: the start page, except a SuperAdmin, who has no start page and lands on Email Templates. */
export const homeFor = (role: Role): string => (role === "SuperAdmin" ? "/templates" : "/");

export const roleLabel: Record<Role, string> = { SuperAdmin: "SuperAdmin", JobSeeker: "JobSeeker", Agency: "Agency" };
