/**
 * Sharing a job to social media to earn a credit. Only LinkedIn and Facebook for now.
 *
 * Neither network tells a website whether the person really posted, so the credit is "honor system with safeguards": it is given once per
 * person per job per network, not sooner than SHARE_CONFIRM_DELAY_MS after the share window was opened, and at most SHARE_DAILY_REWARD_CAP
 * times in 24 hours. Real verification would need the person to connect their LinkedIn / Facebook account (OAuth).
 */
export const SHARE_NETWORKS = ["linkedin", "facebook"] as const;
export type ShareNetwork = (typeof SHARE_NETWORKS)[number];

export const SHARE_NETWORK_LABEL: Record<ShareNetwork, string> = { linkedin: "LinkedIn", facebook: "Facebook" };

/** Credits given for one confirmed share. */
export const SHARE_REWARD = 1;
/** How long after the share window opened the person can confirm: time to actually write the post. */
export const SHARE_CONFIRM_DELAY_MS = 10_000;
/** The most rewarded shares per person in 24 hours. */
export const SHARE_DAILY_REWARD_CAP = 5;

/** The address of the network's own share window for a public link. */
export function shareWindowUrl(network: ShareNetwork, link: string): string {
  const u = encodeURIComponent(link);
  return network === "linkedin" ? `https://www.linkedin.com/sharing/share-offsite/?url=${u}` : `https://www.facebook.com/sharer/sharer.php?u=${u}`;
}
