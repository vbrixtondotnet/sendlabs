/**
 * Status state machines. Pure data and functions: the only place that decides which status
 * changes are legal. Nothing else may write a status directly.
 */
import type { CampaignStatus, RecipientStatus } from "./types";

/* ------------------------------ campaign ------------------------------ */

/**
 * Allowed campaign transitions.
 * - Draft goes straight to Sending at launch in the drip design (the launch request enqueues nothing).
 *   Queuing/Queued exist for bulk-enqueue launches and are kept legal.
 * - CompletedWithErrors can return to Sending when failed recipients are retried.
 * - Failed (for example a broken sender connection) can resume once the cause is fixed.
 */
export const CAMPAIGN_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  Draft: ["Queuing", "Sending"],
  Queuing: ["Queued", "Sending", "Failed", "Cancelled"],
  Queued: ["Sending", "Paused", "Cancelled"],
  Sending: ["Paused", "Completed", "CompletedWithErrors", "Failed", "Cancelled"],
  Paused: ["Sending", "Cancelled"],
  Completed: [],
  CompletedWithErrors: ["Sending"],
  Failed: ["Sending", "Cancelled"],
  Cancelled: [],
};

export const canTransitionCampaign = (from: CampaignStatus, to: CampaignStatus): boolean =>
  CAMPAIGN_TRANSITIONS[from].includes(to);

/** Actions a person can trigger from the UI, mapped to the status change they cause. */
export const CAMPAIGN_ACTIONS = {
  pause: { from: ["Queued", "Sending"], to: "Paused" },
  resume: { from: ["Paused"], to: "Sending" },
  cancel: { from: ["Queuing", "Queued", "Sending", "Paused", "Failed"], to: "Cancelled" },
} as const satisfies Record<string, { from: readonly CampaignStatus[]; to: CampaignStatus }>;
export type CampaignAction = keyof typeof CAMPAIGN_ACTIONS;

/** Content, subject and drip settings are editable only before launch. */
export const isCampaignEditable = (s: CampaignStatus): boolean => s === "Draft";

/** Nothing further will ever be sent. CompletedWithErrors is not final because failures can be retried. */
export const isCampaignFinal = (s: CampaignStatus): boolean => s === "Completed" || s === "Cancelled";

/** A campaign that is mid-flight cannot be archived or deleted. */
export const isCampaignInFlight = (s: CampaignStatus): boolean =>
  s === "Queuing" || s === "Queued" || s === "Sending";

/** Statuses that stamp `completed_at`. */
export const stampsCompletedAt = (s: CampaignStatus): boolean =>
  s === "Completed" || s === "CompletedWithErrors" || s === "Cancelled" || s === "Failed";

/* ------------------------------ recipient ------------------------------ */

/**
 * Allowed recipient transitions.
 * - Queued -> Pending returns messages to the pool when a campaign is paused or a daily cap is hit.
 * - Processing -> Queued is a transient-failure retry or an expired lease.
 * - Failed -> Pending/Queued is an explicit, audited retry.
 * - Accepted, Skipped and Cancelled are final. "Accepted" means Gmail took the message, not inbox delivery.
 */
export const RECIPIENT_TRANSITIONS: Readonly<Record<RecipientStatus, readonly RecipientStatus[]>> = {
  Pending: ["Queued", "Skipped", "Cancelled"],
  Queued: ["Processing", "Pending", "Skipped", "Cancelled"],
  Processing: ["Accepted", "Failed", "Queued", "Skipped"],
  Accepted: [],
  Failed: ["Pending", "Queued", "Cancelled"],
  Skipped: [],
  Cancelled: [],
};

export const canTransitionRecipient = (from: RecipientStatus, to: RecipientStatus): boolean =>
  RECIPIENT_TRANSITIONS[from].includes(to);

/** Recipients that will still be sent unless the campaign is cancelled. */
export const UNSENT_RECIPIENT_STATUSES = ["Pending", "Queued"] as const satisfies readonly RecipientStatus[];
