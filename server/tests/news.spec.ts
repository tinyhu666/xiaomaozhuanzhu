import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
  __resetNewsRefreshStateForTests,
  fetchSourceCategory,
  listEntryToNewsItem,
  maybeKickoffNewsRefresh,
  newsIdFor,
  parseCicpaList,
  refreshAllNews,
  stripHtmlTags,
  type NewsFetcher,
  type NewsSourceCategory
} from "../src/domain/news";
import { MemoryStore } from "../src/store/memory-store";

const SAMPLE_LIST_HTML = `
<html><body>
  <ul class="list">
    <li>
      <a href="/zcks/ksgg/202503/t20250301_12345.html" title="关于2025年注册会计师全国统一考试报名简章的公告">
        关于2025年注册会计师全国统一考试报名简章的公告
      </a>
      <span class="date">2025-03-01</span>
    </li>
    <li>
      <a href="https://www.cicpa.org.cn/zcks/ksgg/202502/t20250228_99999.html">
        2025 年注会考试缴费温馨提示
      </a>
      <em>2025年02月28日</em>
    </li>
    <li>
      <!-- malformed: missing date — should be skipped -->
      <a href="/zcks/ksgg/202501/no-date.html">无日期的条目</a>
    </li>
    <li>
      <!-- duplicate URL — should be deduped -->
      <a href="/zcks/ksgg/202503/t20250301_12345.html" title="dup">dup</a>
      <span>2025-03-01</span>
    </li>
  </ul>
</body></html>`;

describe("CICPA news parser", () => {
  it("strips tags + decodes the entity subset we care about", () => {
    expect(stripHtmlTags("<p>hello&nbsp;<b>world</b>&amp;you</p>")).toBe("hello world&you");
    expect(stripHtmlTags("")).toBe("");
    // script / style content drops entirely
    expect(stripHtmlTags("<script>alert(1)</script>safe")).toBe("safe");
  });

  it("extracts title, absolute URL and ISO date from a CICPA-style list", () => {
    const items = parseCicpaList(SAMPLE_LIST_HTML, "https://www.cicpa.org.cn/zcks/ksgg/");
    expect(items.length).toBe(2);

    expect(items[0]).toMatchObject({
      title: "关于2025年注册会计师全国统一考试报名简章的公告",
      url: "https://www.cicpa.org.cn/zcks/ksgg/202503/t20250301_12345.html"
    });
    expect(items[0].publishedAt).toBe("2025-03-01T00:00:00.000+08:00");

    // Second entry uses Chinese-style date and an absolute URL — both
    // should be picked up.
    expect(items[1].url).toBe("https://www.cicpa.org.cn/zcks/ksgg/202502/t20250228_99999.html");
    expect(items[1].publishedAt).toBe("2025-02-28T00:00:00.000+08:00");
  });

  it("returns an empty array for total garbage HTML (parser never throws)", () => {
    expect(parseCicpaList("<html>garbage with no list</html>", "https://example.com/")).toEqual([]);
    expect(parseCicpaList("", "https://example.com/")).toEqual([]);
  });

  it("rejects non-http(s) URLs", () => {
    const html = `<li><a href="javascript:alert(1)">bad</a><span>2025-01-01</span></li>`;
    expect(parseCicpaList(html, "https://example.com/")).toEqual([]);
  });

  it("newsIdFor is deterministic per (source,url)", () => {
    const id1 = newsIdFor("cicpa", "https://example.com/a");
    const id2 = newsIdFor("cicpa", "https://example.com/a");
    expect(id1).toBe(id2);
    expect(id1).not.toBe(newsIdFor("cicpa", "https://example.com/b"));
    expect(id1.length).toBeGreaterThan(0);
  });

  it("listEntryToNewsItem builds a valid NewsItem with truncation safety", () => {
    const veryLong = "x".repeat(400);
    const item = listEntryToNewsItem(
      { title: veryLong, url: "https://example.com/" + veryLong, publishedAt: "2025-05-01T00:00:00.000+08:00" },
      "cicpa",
      "announce",
      "2025-05-02T00:00:00.000Z"
    );
    expect(item.title.length).toBeLessThanOrEqual(255);
    expect(item.url.length).toBeLessThanOrEqual(255);
    expect(item.summary.length).toBeLessThanOrEqual(200);
    expect(item.hidden).toBe(false);
    expect(item.manual).toBe(false);
    // id is keyed on the original URL — stable across re-truncation.
    expect(item.id.length).toBeGreaterThan(0);
  });
});

describe("CICPA news fetcher", () => {
  const config: NewsSourceCategory = {
    source: "cicpa",
    category: "announce",
    listUrl: "https://example.test/zcks/ksgg/",
    base: "https://example.test/zcks/ksgg/"
  };

  it("propagates fetch errors so the orchestrator can record them", async () => {
    const fetcher: NewsFetcher = async () => {
      throw new Error("ENETDOWN");
    };
    await expect(
      fetchSourceCategory(config, "2025-05-01T00:00:00.000Z", fetcher)
    ).rejects.toThrow(/ENETDOWN/);
  });

  it("emits NewsItems from a successful fetch with stable IDs", async () => {
    const fetcher: NewsFetcher = async () => SAMPLE_LIST_HTML;
    const items = await fetchSourceCategory(config, "2025-05-01T00:00:00.000Z", fetcher);
    expect(items.length).toBe(2);
    expect(items[0].category).toBe("announce");
    expect(items[0].source).toBe("cicpa");
  });
});

describe("refreshAllNews orchestration", () => {
  it("isolates errors per-category and reports counts", async () => {
    const store = new MemoryStore();
    const configs: NewsSourceCategory[] = [
      { source: "cicpa", category: "announce", listUrl: "https://x/a", base: "https://x/a/" },
      { source: "cicpa", category: "outline",  listUrl: "https://x/b", base: "https://x/b/" }
    ];
    const fetcher: NewsFetcher = async (url) => {
      if (url === "https://x/a") return SAMPLE_LIST_HTML;
      throw new Error("boom");
    };
    const summary = await refreshAllNews(store, new Date("2025-05-01T00:00:00Z"), fetcher, configs);
    expect(summary.ok).toBe(true);
    expect(summary.totalInserted).toBe(2);
    expect(summary.perCategory[1].error).toBe("boom");
  });

  it("re-running keeps inserts at 0 and updates non-zero", async () => {
    const store = new MemoryStore();
    const configs: NewsSourceCategory[] = [
      { source: "cicpa", category: "announce", listUrl: "https://x/a", base: "https://x/a/" }
    ];
    const fetcher: NewsFetcher = async () => SAMPLE_LIST_HTML;
    const first = await refreshAllNews(store, new Date("2025-05-01T00:00:00Z"), fetcher, configs);
    expect(first.totalInserted).toBe(2);

    const second = await refreshAllNews(store, new Date("2025-05-02T00:00:00Z"), fetcher, configs);
    expect(second.totalInserted).toBe(0);
    expect(second.totalUpdated).toBe(2);
  });
});

describe("GET /api/news", () => {
  beforeEach(() => {
    __resetNewsRefreshStateForTests();
  });
  afterEach(() => {
    __resetNewsRefreshStateForTests();
  });

  it("serves an empty list with no items, no auth required", async () => {
    const store = new MemoryStore();
    const app = createApp({ store, clock: { now: () => new Date("2025-05-01T00:00:00Z") } });
    const response = await request(app).get("/api/news").expect(200);
    expect(response.body.items).toEqual([]);
    expect(response.body.nextBefore).toBe(null);
  });

  it("returns items sorted by publishedAt descending, with category filter", async () => {
    const store = new MemoryStore();
    await store.upsertNewsBatch([
      makeNews("a", "announce", "2025-03-01"),
      makeNews("b", "outline",  "2025-04-01"),
      makeNews("c", "news",     "2025-05-01")
    ]);

    const app = createApp({ store, clock: { now: () => new Date("2025-05-02T00:00:00Z") } });
    const all = await request(app).get("/api/news").expect(200);
    expect(all.body.items.map((it: { id: string }) => it.id)).toEqual(["c", "b", "a"]);

    const onlyAnnounce = await request(app).get("/api/news?category=announce").expect(200);
    expect(onlyAnnounce.body.items.length).toBe(1);
    expect(onlyAnnounce.body.items[0].id).toBe("a");

    const bogus = await request(app).get("/api/news?category=garbage").expect(200);
    // Unknown category falls back to "all" rather than 400.
    expect(bogus.body.items.length).toBe(3);
  });

  it("supports keyset pagination via `before`", async () => {
    const store = new MemoryStore();
    await store.upsertNewsBatch([
      makeNews("a", "news", "2025-01-01"),
      makeNews("b", "news", "2025-02-01"),
      makeNews("c", "news", "2025-03-01")
    ]);
    const app = createApp({ store, clock: { now: () => new Date("2025-04-01T00:00:00Z") } });
    const firstPage = await request(app).get("/api/news?limit=2").expect(200);
    expect(firstPage.body.items.length).toBe(2);
    expect(firstPage.body.nextBefore).toBeTruthy();

    const secondPage = await request(app)
      .get(`/api/news?limit=2&before=${encodeURIComponent(firstPage.body.nextBefore)}`)
      .expect(200);
    expect(secondPage.body.items.length).toBe(1);
    expect(secondPage.body.items[0].id).toBe("a");
  });

  it("/api/news/:id 404s for missing and for hidden items", async () => {
    const store = new MemoryStore();
    await store.upsertNewsBatch([makeNews("z", "announce", "2025-05-01")]);
    await store.setNewsHidden("z", true);

    const app = createApp({ store, clock: { now: () => new Date("2025-05-02T00:00:00Z") } });
    await request(app).get("/api/news/does-not-exist").expect(404);
    await request(app).get("/api/news/z").expect(404);
  });
});

describe("Lazy refresh kickoff", () => {
  beforeEach(() => {
    __resetNewsRefreshStateForTests();
  });

  it("triggers the first time and respects the 3h cooldown thereafter", async () => {
    const store = new MemoryStore();
    const fetcher = vi.fn<NewsFetcher>(async () => SAMPLE_LIST_HTML);

    const first = maybeKickoffNewsRefresh(store, new Date("2025-05-01T00:00:00Z"), fetcher);
    expect(first.triggered).toBe(true);
    // While in-flight, a second call must NOT trigger another.
    const second = maybeKickoffNewsRefresh(store, new Date("2025-05-01T00:00:01Z"), fetcher);
    expect(second.triggered).toBe(false);
    expect(second.reason).toBe("inflight");

    // Wait for the in-flight refresh to settle by yielding.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Same-hour call: cooldown.
    const third = maybeKickoffNewsRefresh(store, new Date("2025-05-01T00:30:00Z"), fetcher);
    expect(third.triggered).toBe(false);
    expect(third.reason).toBe("cooldown");

    // 4h later: re-triggers.
    const later = maybeKickoffNewsRefresh(store, new Date("2025-05-01T04:30:00Z"), fetcher);
    expect(later.triggered).toBe(true);
  });
});

/** Helper: build a fully-formed NewsItem for store tests. */
function makeNews(id: string, category: "announce" | "outline" | "news", date: string) {
  return {
    id,
    source: "cicpa",
    category,
    title: `Item ${id}`,
    summary: `summary ${id}`,
    content: null,
    url: `https://example.com/${id}`,
    publishedAt: `${date}T00:00:00.000+08:00`,
    fetchedAt: "2025-05-01T00:00:00.000Z",
    hidden: false,
    manual: false
  };
}
