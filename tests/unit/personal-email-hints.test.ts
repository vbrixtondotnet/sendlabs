import { describe, expect, it } from "vitest";
import { findPlaceholders, personalEmailWarnings, placeholderMessage, similarity } from "../../src/shared/personal-email-hints";

const PITCH = "Hi Ann, I recently checked out your company and wanted to reach out. We help construction companies simplify spreadsheets, estimates and project tracking with custom software. Would you be open to a quick chat?";

describe("findPlaceholders", () => {
  it("finds merge tags left in the text, once each", () => {
    expect(findPlaceholders("I checked out {{companyName}}. Is {{companyName}} using {{ software }}?")).toEqual(["{{companyName}}", "{{ software }}"]);
    expect(findPlaceholders("Nothing to fill in here, just { braces } and {single}.")).toEqual([]);
    expect(findPlaceholders("")).toEqual([]);
  });

  it("says which tags to replace", () => {
    expect(placeholderMessage(["{{companyName}}"])).toBe("Replace {{companyName}} with the real text. A one-to-one email is sent exactly as you write it, so merge fields are not filled in");
  });
});

describe("similarity", () => {
  it("is 1 for the same text, high for the same text with a name changed, and low for a different message", () => {
    expect(similarity(PITCH, PITCH)).toBe(1);
    expect(similarity(PITCH, PITCH.replace("Ann", "Bob"))).toBeGreaterThan(0.9);
    expect(similarity(PITCH, "Thanks for the lunch yesterday. Shall we meet on Friday to go over the schedule?")).toBeLessThan(0.2);
    expect(similarity("", PITCH)).toBe(0);
  });
});

describe("personalEmailWarnings", () => {
  const none = { to: "ann@x.test", subject: "Quick question about your estimates", body: "Hi Ann, do you still use spreadsheets for estimates?", recent: [] };

  it("has nothing to say about a short, honest first message", () => {
    expect(personalEmailWarnings(none)).toEqual([]);
  });

  it("warns when almost the same text already went to other people, counting each address once, and not the same address", () => {
    const recent = [
      { to: "bob@x.test", body: PITCH.replace("Ann", "Bob") },
      { to: "BOB@x.test", body: PITCH.replace("Ann", "Bob") },
      { to: "cy@x.test", body: PITCH.replace("Ann", "Cy") },
      { to: "ann@x.test", body: PITCH }, // the same person: not a repeat
      { to: "dee@x.test", body: "Lunch on Friday?" },
    ];
    const w = personalEmailWarnings({ ...none, body: PITCH, recent });
    expect(w.map((x) => x.code)).toEqual(["repeated"]);
    expect(w[0]!.message).toContain("2 other addresses");
    expect(personalEmailWarnings({ ...none, body: PITCH, recent: [{ to: "bob@x.test", body: PITCH }] })[0]!.message).toContain("1 other address.");
  });

  it("warns about a subject that suggests an existing relationship", () => {
    for (const subject of ["Re: our call", "FWD: details", "Sending the Contract Price", "Your invoice", "Quote for the project", "URGENT: reply", "Action required"]) {
      expect(personalEmailWarnings({ ...none, subject }).map((x) => x.code), subject).toEqual(["relationship-subject"]);
    }
    for (const subject of ["Quick question", "Introduction from Sabertooth", "Would a short call help?", "Exploring a Potential Collaboration"]) {
      expect(personalEmailWarnings({ ...none, subject }), subject).toEqual([]);
    }
  });

  it("warns when the text still has the preview's sample company in it", () => {
    for (const body of ["I checked out Example Co and wanted to reach out.", "i checked out EXAMPLE CO today"]) {
      expect(personalEmailWarnings({ ...none, body }).map((x) => x.code), body).toEqual(["sample-data"]);
    }
    expect(personalEmailWarnings({ ...none, subject: "Ideas for Example Co" }).map((x) => x.code)).toEqual(["sample-data"]);
    expect(personalEmailWarnings({ ...none, body: "I checked out Acme Builders." })).toEqual([]);
  });

  it("warns about a price in the message, in dollars or another currency, but not a plain number", () => {
    for (const body of ["Projects start around $5,000 depending on scope.", "From USD 10,000.", "Only €2,500 for a start", "About ₱250,000.50"]) {
      expect(personalEmailWarnings({ ...none, body }).map((x) => x.code), body).toEqual(["price"]);
    }
    expect(personalEmailWarnings({ ...none, body: "We have 5 people and 12 projects, and I will call at 3." })).toEqual([]);
  });

  it("warns about a long first message, with its length", () => {
    const w = personalEmailWarnings({ ...none, body: "word ".repeat(200) });
    expect(w.map((x) => x.code)).toEqual(["long"]);
    expect(w[0]!.message).toContain("999 characters");
  });

  it("can give several warnings at once", () => {
    const w = personalEmailWarnings({ ...none, subject: "Re: quote", body: PITCH.repeat(4) + " From $5,000 for Example Co.", recent: [{ to: "bob@x.test", body: PITCH.repeat(4) + " From $5,000 for Example Co." }] });
    expect(w.map((x) => x.code).sort()).toEqual(["long", "price", "relationship-subject", "repeated", "sample-data"]);
  });
});
