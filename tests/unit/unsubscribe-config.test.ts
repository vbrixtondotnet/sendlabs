import { describe, expect, it } from "vitest";
import { unsubscribeConfig, unsubscribeLinks } from "../../src/server/lib/unsubscribe";

const CFG = { encryptionKey: "key", appBaseUrl: "http://localhost:5173" };

describe("unsubscribeConfig", () => {
  it("points the links at UNSUBSCRIBE_BASE_URL when it is a public https address, and keeps the signing key", () => {
    expect(unsubscribeConfig({ UNSUBSCRIBE_BASE_URL: "https://sabertoothsoftwarelabs.net" }, CFG)).toEqual({ encryptionKey: "key", appBaseUrl: "https://sabertoothsoftwarelabs.net" });
    expect(unsubscribeConfig({ UNSUBSCRIBE_BASE_URL: " https://mail.acme.test/some/path/ " }, CFG)?.appBaseUrl).toBe("https://mail.acme.test"); // origin only
  });

  it("uses APP_BASE_URL when it is not set or empty", () => {
    expect(unsubscribeConfig({}, CFG)).toEqual(CFG);
    expect(unsubscribeConfig({ UNSUBSCRIBE_BASE_URL: "" }, CFG)).toEqual(CFG);
    expect(unsubscribeConfig({ UNSUBSCRIBE_BASE_URL: "   " }, CFG)).toEqual(CFG);
  });

  it("allows http only for localhost, and ignores anything that is not a usable address", () => {
    expect(unsubscribeConfig({ UNSUBSCRIBE_BASE_URL: "http://localhost:8787" }, CFG)?.appBaseUrl).toBe("http://localhost:8787");
    for (const bad of ["http://sabertoothsoftwarelabs.net", "javascript:alert(1)", "ftp://x.test", "not a url", "//x.test"]) {
      expect(unsubscribeConfig({ UNSUBSCRIBE_BASE_URL: bad }, CFG), bad).toEqual(CFG);
    }
  });

  it("is null when the server is not set up for unsubscribe links at all", () => {
    expect(unsubscribeConfig({ UNSUBSCRIBE_BASE_URL: "https://sabertoothsoftwarelabs.net" }, null)).toBeNull();
  });

  it("makes the page and one-click addresses from it", () => {
    expect(unsubscribeLinks("https://sabertoothsoftwarelabs.net", "T")).toEqual({ page: "https://sabertoothsoftwarelabs.net/unsubscribe/T", oneClick: "https://sabertoothsoftwarelabs.net/api/unsubscribe/T" });
  });
});
