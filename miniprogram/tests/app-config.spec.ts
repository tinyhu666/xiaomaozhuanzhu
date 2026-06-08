import { describe, expect, it } from "vitest";

import { isClientVersionBelow } from "../utils/api";

/**
 * v0.42 — version gate comparison used by the launch-time app gate
 * (forced-upgrade nudge). Must be numeric, not lexicographic, so 0.9 < 0.10.
 */
describe("isClientVersionBelow", () => {
  it("gate disabled when min is empty", () => {
    expect(isClientVersionBelow("0.41.0", "")).toBe(false);
  });

  it("detects a strictly lower version (numeric, not lexicographic)", () => {
    expect(isClientVersionBelow("0.41.0", "0.42.0")).toBe(true);
    expect(isClientVersionBelow("0.41.9", "0.42.0")).toBe(true);
    expect(isClientVersionBelow("0.9.0", "0.10.0")).toBe(true);
  });

  it("returns false at or above min", () => {
    expect(isClientVersionBelow("0.42.0", "0.42.0")).toBe(false);
    expect(isClientVersionBelow("0.42.1", "0.42.0")).toBe(false);
    expect(isClientVersionBelow("1.0.0", "0.42.0")).toBe(false);
  });

  it("handles differing segment counts", () => {
    expect(isClientVersionBelow("0.42", "0.42.0")).toBe(false);
    expect(isClientVersionBelow("0.42", "0.42.1")).toBe(true);
  });
});
