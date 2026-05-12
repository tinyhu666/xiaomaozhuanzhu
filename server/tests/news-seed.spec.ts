import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { buildSeedNewsItems, ensureNewsSeed } from "../src/domain/news-seed";
import { MemoryStore } from "../src/store/memory-store";

describe("news seed", () => {
  it("buildSeedNewsItems returns ≥3 pinned manual items with unique URLs", () => {
    const items = buildSeedNewsItems(new Date("2025-05-01T00:00:00Z"));
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const item of items) {
      expect(item.manual).toBe(true);
      expect(item.pinned).toBe(true);
      expect(item.url).toMatch(/^https?:\/\//);
    }
    const urls = items.map((item) => item.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("ensureNewsSeed is idempotent — second call doesn't duplicate rows", async () => {
    const store = new MemoryStore();
    const first = await ensureNewsSeed(store, new Date("2025-05-01T00:00:00Z"));
    const second = await ensureNewsSeed(store, new Date("2025-05-02T00:00:00Z"));
    expect(first).toBe(second);

    const items = await store.listNews({ limit: 100 });
    // No duplicates: count equals what buildSeedNewsItems returned.
    expect(items.length).toBe(first);
  });

  it("createApp installs the seed so /api/news is never empty on a fresh store", async () => {
    const store = new MemoryStore();
    const app = createApp({ store, clock: { now: () => new Date("2025-05-01T00:00:00Z") } });
    // Give the fire-and-forget seed promise a tick to resolve.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const response = await request(app).get("/api/news").expect(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    // All seeded items should be flagged as official-source pins from
    // the client's perspective by being first in the list and tagged
    // category-appropriately.
    const first = response.body.items[0];
    expect(["announce", "outline", "news"]).toContain(first.category);
  });
});
