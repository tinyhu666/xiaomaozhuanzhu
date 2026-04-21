import { describe, expect, it } from "vitest";

import { selectDailyHomeQuote } from "../src/quotes/select-daily-quote";
import { MemoryStore } from "../src/store/memory-store";

describe("home quote rotation", () => {
  it("assigns five daily quote slots for a user", async () => {
    const store = new MemoryStore();
    const now = "2026-04-21T08:00:00.000Z";

    await store.saveQuoteSources([
      {
        id: "source-1",
        name: "seed",
        baseUrl: "https://example.com",
        fetchType: "seed",
        isActive: true,
        lastFetchedAt: now,
        createdAt: now,
        updatedAt: now
      }
    ]);

    await store.saveQuotes(
      Array.from({ length: 5 }, (_item, index) => ({
        id: `quote-${index + 1}`,
        quoteEn: `Quote ${index + 1}`,
        quoteZh: `语录 ${index + 1}`,
        author: "Unknown",
        topic: "discipline",
        sourceId: "source-1",
        sourceUrl: `https://example.com/${index + 1}`,
        rawTitle: "seed",
        fingerprint: `fp-${index + 1}`,
        qualityScore: 80,
        isActive: true,
        createdAt: now,
        updatedAt: now
      }))
    );

    await selectDailyHomeQuote({
      store,
      userId: "user-1",
      quoteDate: "2026-04-21",
      now,
      event: "advance"
    });

    const dailyQuotes = await store.getUserDailyQuotes("user-1", "2026-04-21");

    expect(dailyQuotes).toHaveLength(5);
    expect(dailyQuotes.map((item) => item.slot)).toEqual([1, 2, 3, 4, 5]);
  });

  it("loops through the same five quotes from the sixth visit onward", async () => {
    const store = new MemoryStore();
    const now = "2026-04-21T08:00:00.000Z";

    await store.saveQuoteSources([
      {
        id: "source-1",
        name: "seed",
        baseUrl: "https://example.com",
        fetchType: "seed",
        isActive: true,
        lastFetchedAt: now,
        createdAt: now,
        updatedAt: now
      }
    ]);

    await store.saveQuotes(
      Array.from({ length: 6 }, (_item, index) => ({
        id: `quote-${index + 1}`,
        quoteEn: `Quote ${index + 1}`,
        quoteZh: `语录 ${index + 1}`,
        author: "Unknown",
        topic: "discipline",
        sourceId: "source-1",
        sourceUrl: `https://example.com/${index + 1}`,
        rawTitle: "seed",
        fingerprint: `fp-${index + 1}`,
        qualityScore: 80 - index,
        isActive: true,
        createdAt: now,
        updatedAt: now
      }))
    );

    const indices: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      const result = await selectDailyHomeQuote({
        store,
        userId: "user-1",
        quoteDate: "2026-04-21",
        now,
        event: "advance"
      });
      indices.push(result.dailyIndex);
    }

    expect(indices).toEqual([1, 2, 3, 4, 5, 1, 2]);
  });
});
