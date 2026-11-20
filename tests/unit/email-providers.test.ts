import { describe, expect, it } from "vitest";
import { emailProviderFor } from "../../src/server/services/email-providers";

const deps = { db: {} as never, google: {} as never, googleConfig: null };

describe("choosing the email provider", () => {
  it("is Gmail unless EMAIL_PROVIDER says otherwise, whatever its letter case or spacing", () => {
    expect(emailProviderFor({}, deps).id).toBe("gmail");
    expect(emailProviderFor({ EMAIL_PROVIDER: " Gmail " }, deps).id).toBe("gmail");
    expect(emailProviderFor({ EMAIL_PROVIDER: "" }, deps).id).toBe("gmail"); // an empty setting is the same as none
    expect(emailProviderFor({ EMAIL_PROVIDER: "POSTMARK" }, deps).id).toBe("postmark");
  });

  it("refuses a provider that does not exist, naming what is supported", () => {
    expect(() => emailProviderFor({ EMAIL_PROVIDER: "carrier-pigeon" }, deps)).toThrow(/Unknown EMAIL_PROVIDER "carrier-pigeon". Supported: gmail, postmark/);
  });
});
