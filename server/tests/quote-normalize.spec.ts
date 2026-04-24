import { describe, expect, it } from "vitest";

import { buildQuoteFingerprint, normalizeQuoteText } from "../src/quotes/normalize";

describe("quote normalization", () => {
  it("normalizes punctuation and collapses whitespace", () => {
    expect(normalizeQuoteText("  Focus   wins.  ")).toBe("Focus wins.");
    expect(normalizeQuoteText("Stay&nbsp;steady<br>keep going")).toBe("Stay steady keep going");
  });

  it("builds identical fingerprints for punctuation-only differences", () => {
    expect(buildQuoteFingerprint("Never stop.", "永不停止。")).toBe(
      buildQuoteFingerprint("Never stop!", "永不停止")
    );
  });
});
