/**
 * What is still mock: the Settings page (users and the suppression list).
 * Contacts, campaigns and imports are real and come from the API.
 * Everything here is fake and fixed, so the Settings preview looks the same every time.
 */
import type { AppUser, SuppressionEntry } from "@shared/types";

const at = (isoDate: string) => `${isoDate}T09:00:00.000Z`;

export const users: AppUser[] = [
  { id: "u1", name: "Brian V.", email: "bvillanueva@itimpact.com", role: "Administrator", lastActive: at("2026-11-06") },
  { id: "u2", name: "Dana L.", email: "dana.l@itimpact.example", role: "Campaign Manager", lastActive: at("2026-11-06") },
  { id: "u3", name: "Marcus T.", email: "marcus.t@itimpact.example", role: "Campaign Manager", lastActive: at("2026-11-03") },
  { id: "u4", name: "Priya S.", email: "priya.s@itimpact.example", role: "Viewer", lastActive: at("2026-10-31") },
];

export const suppressions: SuppressionEntry[] = [
  { email: "karen.hughes@silverline.example", reason: "Unsubscribed", addedAt: at("2026-11-05") },
  { email: "tom.rossi@keystone.example", reason: "Unsubscribed", addedAt: at("2026-11-04") },
  { email: "bounce.test@redwood.example", reason: "Bounced", addedAt: at("2026-11-02") },
  { email: "legal@cedarpine.example", reason: "Complaint", addedAt: at("2026-11-01") },
  { email: "do.not.contact@apexfreight.example", reason: "Manual", addedAt: at("2026-10-28") },
  { email: "jamie.cho@tandem.example", reason: "Unsubscribed", addedAt: at("2026-10-27") },
  { email: "lee.ortiz@harborpoint.example", reason: "Unsubscribed", addedAt: at("2026-10-25") },
  { email: "sam.reyes@orchardvalley.example", reason: "Bounced", addedAt: at("2026-10-24") },
];
