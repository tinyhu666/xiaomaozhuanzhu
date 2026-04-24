import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildIngestRows } from "../src/quotes/ingest-quotes";
import { extractHjEnglishQuotes } from "../src/quotes/sources/hujiang";
import { extractSinaQuotes } from "../src/quotes/sources/sina";

describe("quote parsers", () => {
  it("extracts bilingual quote pairs from the Sina fixture", () => {
    const html = readFileSync(path.resolve(process.cwd(), "server/tests/fixtures/quotes/sina-1.html"), "utf8");
    const result = extractSinaQuotes(html, "https://edu.sina.com.cn/example");

    expect(result[0]).toMatchObject({
      quoteEn: expect.any(String),
      quoteZh: expect.any(String),
      sourceName: "sina-education"
    });
    expect(result).toHaveLength(2);
  });

  it("extracts bilingual quote pairs from the Hujiang fixture", () => {
    const html = readFileSync(path.resolve(process.cwd(), "server/tests/fixtures/quotes/hujiang-1.html"), "utf8");
    const result = extractHjEnglishQuotes(html, "https://www.hjenglish.com/example");

    expect(result[0]).toMatchObject({
      quoteEn: expect.any(String),
      quoteZh: expect.any(String),
      sourceName: "hujiang-bilingual"
    });
    expect(result).toHaveLength(2);
  });

  it("turns parsed quote items into insertable quote rows", () => {
    const rows = buildIngestRows(
      [
        {
          sourceId: "sina-education",
          sourceName: "sina-education",
          sourceUrl: "https://example.com/1",
          quoteEn: "Focus on the step in front of you.",
          quoteZh: "专注脚下这一步。",
          author: "",
          topic: "discipline",
          rawTitle: "seed"
        },
        {
          sourceId: "sina-education",
          sourceName: "sina-education",
          sourceUrl: "https://example.com/1",
          quoteEn: "Focus on the step in front of you!",
          quoteZh: "专注脚下这一步",
          author: "",
          topic: "discipline",
          rawTitle: "seed"
        }
      ],
      "2026-04-21T00:00:00.000Z"
    );

    expect(rows.quoteSources[0]).toMatchObject({
      id: "sina-education",
      isActive: true
    });
    expect(rows.quotes[0].fingerprint).toBeTruthy();
    expect(rows.quotes[0].isActive).toBe(true);
    expect(rows.quotes).toHaveLength(1);
    expect(rows.skippedDuplicates).toBe(1);
  });
});
