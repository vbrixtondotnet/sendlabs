import { describe, expect, it } from "vitest";
import { authEnabled, devShortcutAllowed } from "../../src/server/lib/auth-enabled";

describe("authEnabled", () => {
  it("is always on locally", () => {
    expect(authEnabled({ ENVIRONMENT: "local" })).toBe(true);
    expect(authEnabled({ ENVIRONMENT: "local", AUTH_ENABLED: "false" })).toBe(true);
  });

  it("is closed everywhere else until AUTH_ENABLED is exactly \"true\"", () => {
    for (const environment of ["production", "staging", "preview", "", undefined]) {
      expect(authEnabled({ ENVIRONMENT: environment }), String(environment)).toBe(false);
      expect(authEnabled({ ENVIRONMENT: environment, AUTH_ENABLED: "true" }), String(environment)).toBe(true);
    }
  });

  it("does not take anything else for a yes", () => {
    for (const v of ["", "TRUE", "True", "1", "yes", "on", " true", "true ", "false"]) {
      expect(authEnabled({ ENVIRONMENT: "production", AUTH_ENABLED: v }), JSON.stringify(v)).toBe(false);
    }
  });
});

describe("devShortcutAllowed", () => {
  it("is for the local environment only, whatever else is switched on", () => {
    expect(devShortcutAllowed({ ENVIRONMENT: "local" })).toBe(true);
    for (const environment of ["production", "staging", "", undefined]) expect(devShortcutAllowed({ ENVIRONMENT: environment })).toBe(false);
  });
});
