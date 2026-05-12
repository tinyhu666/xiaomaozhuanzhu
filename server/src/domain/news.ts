/**
 * CICPA news fetcher + parser for the miniprogram「动态」tab.
 *
 * Design goals
 * ============
 *   - **No third-party HTML parser.** We only consume CICPA's published
 *     category lists, so a small focused regex parser is enough and
 *     keeps the cloud-run image lean. The parser is pure (HTML in →
 *     items out) so it can be exercised without network in tests.
 *   - **Resilience over completeness.** Real Chinese gov sites
 *     occasionally swap layouts. Every step is wrapped in try/catch
 *     and a failing category falls back to "no new items" — the cache
 *     still serves users.
 *   - **Idempotent.** The fetcher emits stable IDs derived from
 *     `sha1(source:url)`, so re-running the refresh against the same
 *     listing page produces the same NewsItem.id every time and the
 *     store's UNIQUE(source, url) merges cleanly.
 *
 * Out of scope (intentional)
 *   - Full article body fetching. The first cut keeps the implementation
 *     listing-only (title + date + url). We expose a "查看原文"
 *     button in the miniprogram for the source page. A future iteration
 *     can fetch detail pages and populate `content`.
 */

import { createHash } from "node:crypto";

import type { NewsCategory, NewsItem } from "../types";
import type { DataStore } from "../store/types";

/** Public sources we know how to fetch. */
export type NewsSource = "cicpa";

/** Per-category endpoint configuration. */
export type NewsSourceCategory = {
  source: NewsSource;
  category: NewsCategory;
  /** Listing-page URL (HTML). */
  listUrl: string;
  /** Base URL used to resolve relative `<a href>` values. */
  base: string;
};

/**
 * CICPA listing pages. The base www.cicpa.org.cn/zcks tree groups CPA
 * exam content. We map the three sub-trees we care about onto our
 * three top-level categories.
 *
 * If CICPA ever renames a path, only this table needs to change.
 */
export const CICPA_SOURCES: NewsSourceCategory[] = [
  {
    source: "cicpa",
    category: "announce",
    listUrl: "https://www.cicpa.org.cn/zcks/ksgg/",
    base: "https://www.cicpa.org.cn/zcks/ksgg/"
  },
  {
    source: "cicpa",
    category: "outline",
    listUrl: "https://www.cicpa.org.cn/zcks/ksdg/",
    base: "https://www.cicpa.org.cn/zcks/ksdg/"
  },
  {
    source: "cicpa",
    category: "news",
    listUrl: "https://www.cicpa.org.cn/zcks/ksdt/",
    base: "https://www.cicpa.org.cn/zcks/ksdt/"
  }
];

/** A row scraped out of a CICPA listing page, pre-typing. */
export type ParsedListEntry = {
  title: string;
  url: string;
  publishedAt: string; // ISO
};

/* -------------------------------------------------------------------------- */
/*  Pure parser                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Extracts (title, href, date) triples from a CICPA-style listing
 * page. We look for `<li>...</li>` blocks containing an `<a href=...>`
 * and a `YYYY-MM-DD` date stamp anywhere inside.
 *
 * Defensive choices:
 *   - We don't require any specific class names. CICPA's wrapper
 *     classes have changed at least once historically; matching the
 *     elements directly is more durable.
 *   - We dedupe on absolute URL — the same article often appears in
 *     two adjacent containers (mobile / desktop bundles).
 *   - If a row is missing a date, we skip it (no date → can't sort).
 */
export function parseCicpaList(html: string, base: string): ParsedListEntry[] {
  if (!html) return [];
  // `[\s\S]` rather than `.` so we span newlines without /s flag (still
  // supported, but this keeps Node 18 happy on older toolchains).
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  const results: ParsedListEntry[] = [];
  const seenUrls = new Set<string>();

  for (const match of html.matchAll(liRegex)) {
    const inner = match[1];
    const entry = parseSingleListBlock(inner, base);
    if (!entry) continue;
    if (seenUrls.has(entry.url)) continue;
    seenUrls.add(entry.url);
    results.push(entry);
  }
  return results;
}

/** Same shape as parseCicpaList but accepts any block (used for fallback). */
function parseSingleListBlock(inner: string, base: string): ParsedListEntry | null {
  const anchor = inner.match(/<a\b[^>]*\bhref\s*=\s*"([^"#]+)"[^>]*>([\s\S]*?)<\/a>/i);
  if (!anchor) return null;
  const rawHref = anchor[1].trim();
  const rawTitleHtml = anchor[2];
  // Prefer the title attribute when present — CICPA truncates the
  // visible anchor text but ships the full title in `title="..."`.
  const titleAttr = inner.match(/title\s*=\s*"([^"]+)"/i)?.[1] ?? "";
  const title = stripHtmlTags(titleAttr || rawTitleHtml).trim();
  if (!title) return null;

  const dateMatch = inner.match(/(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})/);
  if (!dateMatch) return null;
  const [, y, m, d] = dateMatch;
  const iso = toIso(y, m, d);
  if (!iso) return null;

  const url = resolveUrl(rawHref, base);
  if (!url) return null;
  return { title, url, publishedAt: iso };
}

/**
 * Bare-bones tag stripper. Decodes the small handful of HTML entities
 * we actually see on Chinese gov sites; anything more exotic falls
 * through as-is.
 */
export function stripHtmlTags(html: string): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function toIso(y: string, m: string, d: string): string | null {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  // CICPA dates are wall-clock in Shanghai; treat as midnight Shanghai.
  return `${year}-${mm}-${dd}T00:00:00.000+08:00`;
}

function resolveUrl(href: string, base: string): string | null {
  try {
    const resolved = new URL(href, base).toString();
    // Lock down protocol to http(s).
    if (!/^https?:\/\//i.test(resolved)) return null;
    return resolved;
  } catch {
    return null;
  }
}

/** Stable, deterministic ID for a (source, url) pair. */
export function newsIdFor(source: string, url: string): string {
  return createHash("sha1").update(`${source}:${url}`).digest("hex").slice(0, 32);
}

/* -------------------------------------------------------------------------- */
/*  Item assembly                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Convert a parsed listing row into a NewsItem suitable for upsert.
 * Summary is the title itself for listing-only entries; the admin can
 * edit summary later, or a future iteration can derive it from the
 * article body.
 */
export function listEntryToNewsItem(
  entry: ParsedListEntry,
  source: NewsSource,
  category: NewsCategory,
  fetchedAt: string
): NewsItem {
  return {
    id: newsIdFor(source, entry.url),
    source,
    category,
    title: truncate(entry.title, 255),
    summary: truncate(entry.title, 200),
    content: null,
    url: truncate(entry.url, 255),
    publishedAt: entry.publishedAt,
    fetchedAt,
    hidden: false,
    manual: false,
    // Fetched items are listed by date; the seed (manual=1) already
    // marks the "always-on" reference cards as pinned.
    pinned: false
  };
}

function truncate(value: string, max: number): string {
  if (!value) return "";
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}

/* -------------------------------------------------------------------------- */
/*  Network IO                                                                 */
/* -------------------------------------------------------------------------- */

export type NewsFetcher = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> }
) => Promise<string>;

/** Default fetcher: global fetch + UTF-8 decoded body, with a 10s timeout. */
export const defaultNewsFetcher: NewsFetcher = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      signal: init?.signal ?? controller.signal,
      headers: {
        // CICPA serves slightly different layouts to non-browser
        // user agents; pretend to be a desktop Chrome for stability.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        ...(init?.headers ?? {})
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    // CICPA serves utf-8; ArrayBuffer + manual decode avoids the
    // "ISO-8859-1" fallback some hosts try.
    const buf = await response.arrayBuffer();
    return new TextDecoder("utf-8").decode(buf);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Fetch a single source/category and convert its listing into
 * NewsItems. Network / parse errors propagate up so `refreshAllNews`
 * can record the cause; callers using this directly should wrap in
 * try/catch.
 */
export async function fetchSourceCategory(
  config: NewsSourceCategory,
  fetchedAt: string,
  fetcher: NewsFetcher = defaultNewsFetcher
): Promise<NewsItem[]> {
  const html = await fetcher(config.listUrl);
  const entries = parseCicpaList(html, config.base);
  return entries.map((entry) => listEntryToNewsItem(entry, config.source, config.category, fetchedAt));
}

/* -------------------------------------------------------------------------- */
/*  Orchestration                                                              */
/* -------------------------------------------------------------------------- */

export type NewsRefreshSummary = {
  ok: boolean;
  fetchedAt: string;
  perCategory: Array<{
    source: NewsSource;
    category: NewsCategory;
    parsed: number;
    inserted: number;
    updated: number;
    error: string | null;
  }>;
  totalInserted: number;
  totalUpdated: number;
};

/**
 * Refresh every configured CICPA category and merge into the store.
 * Errors are isolated per category.
 */
export async function refreshAllNews(
  store: Pick<DataStore, "upsertNewsBatch">,
  now: Date,
  fetcher: NewsFetcher = defaultNewsFetcher,
  sources: NewsSourceCategory[] = CICPA_SOURCES
): Promise<NewsRefreshSummary> {
  const fetchedAt = now.toISOString();
  const perCategory: NewsRefreshSummary["perCategory"] = [];
  let totalInserted = 0;
  let totalUpdated = 0;
  let anyOk = false;

  for (const config of sources) {
    try {
      const items = await fetchSourceCategory(config, fetchedAt, fetcher);
      const { inserted, updated } = await store.upsertNewsBatch(items);
      perCategory.push({
        source: config.source,
        category: config.category,
        parsed: items.length,
        inserted,
        updated,
        error: items.length === 0 ? "no_items_parsed" : null
      });
      totalInserted += inserted;
      totalUpdated += updated;
      if (items.length > 0) anyOk = true;
    } catch (error) {
      perCategory.push({
        source: config.source,
        category: config.category,
        parsed: 0,
        inserted: 0,
        updated: 0,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    ok: anyOk,
    fetchedAt,
    perCategory,
    totalInserted,
    totalUpdated
  };
}

/* -------------------------------------------------------------------------- */
/*  Lazy refresh: fire-and-forget on user reads                                */
/* -------------------------------------------------------------------------- */

/**
 * Module-local state for the lazy refresh. A single in-flight refresh
 * is allowed at a time; subsequent triggers within the cooldown
 * window are no-ops. Process-local — fine for the single-instance
 * cloud-run deployment; if we ever scale horizontally we'd move this
 * into a small `news_meta` table.
 */
// Lazy refresh window. The first /api/news read after this gap kicks
// off a background re-fetch; subsequent reads serve the existing
// cache. 2h is a reasonable trade-off between freshness (CICPA can
// drop time-sensitive notices during 报名 / 缴费 / 出分 windows) and
// avoiding wasted egress on the auto-suspending cloud-run instance.
const REFRESH_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2h
let inflight: Promise<NewsRefreshSummary> | null = null;
let lastSuccessfulAt = 0;

/** Test seam: lets the test suite reset module state between cases. */
export function __resetNewsRefreshStateForTests() {
  inflight = null;
  lastSuccessfulAt = 0;
}

/**
 * Called by the public `GET /api/news` handler. Kicks off an async
 * refresh if the cache is stale; never blocks the caller. Returns
 * info about whether a refresh was triggered, primarily for tests.
 */
export function maybeKickoffNewsRefresh(
  store: Pick<DataStore, "upsertNewsBatch">,
  now: Date,
  fetcher: NewsFetcher = defaultNewsFetcher
): { triggered: boolean; reason: "cooldown" | "inflight" | "kicked" } {
  if (inflight) return { triggered: false, reason: "inflight" };
  if (now.getTime() - lastSuccessfulAt < REFRESH_COOLDOWN_MS && lastSuccessfulAt > 0) {
    return { triggered: false, reason: "cooldown" };
  }
  inflight = refreshAllNews(store, now, fetcher)
    .then((summary) => {
      if (summary.ok) lastSuccessfulAt = now.getTime();
      return summary;
    })
    .catch((error) => {
      console.warn("[news] background refresh failed", error);
      return {
        ok: false,
        fetchedAt: now.toISOString(),
        perCategory: [],
        totalInserted: 0,
        totalUpdated: 0
      } as NewsRefreshSummary;
    })
    .finally(() => {
      inflight = null;
    });
  return { triggered: true, reason: "kicked" };
}

/** Block on an in-flight refresh if one is happening — admin endpoint uses this. */
export async function waitForCurrentRefresh(): Promise<NewsRefreshSummary | null> {
  if (!inflight) return null;
  return inflight;
}
