import { describe, expect, it } from "vitest";
import { newId } from "../../src/server/lib/id";

describe("newId (UUIDv7)", () => {
  it("has the UUID shape with version 7 and the RFC 4122 variant", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("embeds the millisecond timestamp in the first 48 bits", () => {
    const t = 1_762_400_000_123;
    const hex = newId(t).replace(/-/g, "").slice(0, 12);
    expect(parseInt(hex, 16)).toBe(t);
  });
  it("sorts by creation time", () => {
    const ids = [1000, 5000, 999_999, 1_762_400_000_000, 1_762_400_000_001].map((t) => newId(t));
    expect([...ids].sort()).toEqual(ids);
  });
  it("does not collide", () => {
    const seen = new Set(Array.from({ length: 5000 }, () => newId()));
    expect(seen.size).toBe(5000);
  });
});
