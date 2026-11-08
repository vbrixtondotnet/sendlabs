import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_ACTIONS,
  CAMPAIGN_TRANSITIONS,
  RECIPIENT_TRANSITIONS,
  canTransitionCampaign,
  canTransitionRecipient,
  isCampaignEditable,
  isCampaignFinal,
  isCampaignInFlight,
} from "../../src/shared/status";
import { CAMPAIGN_STATUSES, RECIPIENT_STATUSES } from "../../src/shared/types";

describe("campaign state machine", () => {
  it("defines every status, and only references real statuses", () => {
    expect(Object.keys(CAMPAIGN_TRANSITIONS).sort()).toEqual([...CAMPAIGN_STATUSES].sort());
    for (const targets of Object.values(CAMPAIGN_TRANSITIONS)) {
      for (const t of targets) expect(CAMPAIGN_STATUSES).toContain(t);
    }
  });

  it("has no self-transitions", () => {
    for (const s of CAMPAIGN_STATUSES) expect(canTransitionCampaign(s, s)).toBe(false);
  });

  it("cannot leave Completed or Cancelled", () => {
    for (const final of ["Completed", "Cancelled"] as const) {
      for (const to of CAMPAIGN_STATUSES) expect(canTransitionCampaign(final, to)).toBe(false);
    }
  });

  it("only launches from Draft, and Draft cannot be paused, resumed or cancelled", () => {
    expect(canTransitionCampaign("Draft", "Sending")).toBe(true);
    expect(canTransitionCampaign("Draft", "Paused")).toBe(false);
    expect(canTransitionCampaign("Draft", "Cancelled")).toBe(false);
    for (const s of CAMPAIGN_STATUSES) {
      if (s !== "Draft") expect(canTransitionCampaign(s, "Draft")).toBe(false);
    }
  });

  it("lets a campaign with errors or a failure return to Sending (retry)", () => {
    expect(canTransitionCampaign("CompletedWithErrors", "Sending")).toBe(true);
    expect(canTransitionCampaign("Failed", "Sending")).toBe(true);
  });

  it("keeps every user action consistent with the transition table", () => {
    for (const [name, def] of Object.entries(CAMPAIGN_ACTIONS)) {
      for (const from of def.from) {
        expect(canTransitionCampaign(from, def.to), `${name}: ${from} -> ${def.to}`).toBe(true);
      }
    }
  });

  it("resume is only possible from Paused, pause never from Paused", () => {
    expect(CAMPAIGN_ACTIONS.resume.from).toEqual(["Paused"]);
    expect(CAMPAIGN_ACTIONS.pause.from).not.toContain("Paused");
  });

  it("classifies statuses for editing, archiving and finality", () => {
    expect(CAMPAIGN_STATUSES.filter(isCampaignEditable)).toEqual(["Draft"]);
    expect(CAMPAIGN_STATUSES.filter(isCampaignInFlight)).toEqual(["Queuing", "Queued", "Sending"]);
    expect(CAMPAIGN_STATUSES.filter(isCampaignFinal)).toEqual(["Completed", "Cancelled"]);
  });
});

describe("recipient state machine", () => {
  it("defines every status, and only references real statuses", () => {
    expect(Object.keys(RECIPIENT_TRANSITIONS).sort()).toEqual([...RECIPIENT_STATUSES].sort());
    for (const targets of Object.values(RECIPIENT_TRANSITIONS)) {
      for (const t of targets) expect(RECIPIENT_STATUSES).toContain(t);
    }
  });

  it("treats Accepted, Skipped and Cancelled as final", () => {
    for (const final of ["Accepted", "Skipped", "Cancelled"] as const) {
      for (const to of RECIPIENT_STATUSES) expect(canTransitionRecipient(final, to)).toBe(false);
    }
  });

  it("only reaches Accepted from Processing (never claims acceptance without a send attempt)", () => {
    for (const from of RECIPIENT_STATUSES) {
      expect(canTransitionRecipient(from, "Accepted")).toBe(from === "Processing");
    }
  });

  it("only reaches Processing from Queued (a job must be claimed from the queue)", () => {
    for (const from of RECIPIENT_STATUSES) {
      expect(canTransitionRecipient(from, "Processing")).toBe(from === "Queued");
    }
  });

  it("supports the recovery paths", () => {
    expect(canTransitionRecipient("Queued", "Pending")).toBe(true); // paused or daily cap reached
    expect(canTransitionRecipient("Processing", "Queued")).toBe(true); // transient failure, expired lease
    expect(canTransitionRecipient("Failed", "Pending")).toBe(true); // explicit retry
  });
});
