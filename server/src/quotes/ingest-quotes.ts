import { randomUUID } from "node:crypto";

import type { DataStore } from "../store/types";
import type { Quote, QuoteSource } from "../types";
import { buildQuoteFingerprint, normalizeQuoteText } from "./normalize";
import { HUJIANG_SOURCE } from "./sources/hujiang";
import { SINA_SOURCE } from "./sources/sina";
import type { IngestSummary, ParsedQuote, QuoteSourceDefinition } from "./types";

export const DEFAULT_QUOTE_SOURCES: QuoteSourceDefinition[] = [SINA_SOURCE, HUJIANG_SOURCE];

export function buildIngestRows(items: ParsedQuote[], now = new Date().toISOString()) {
  const quoteSources = new Map<string, QuoteSource>();
  const quotes: Quote[] = [];
  const fingerprints = new Set<string>();
  let skippedDuplicates = 0;

  for (const item of items) {
    const quoteEn = normalizeQuoteText(item.quoteEn);
    const quoteZh = normalizeQuoteText(item.quoteZh);
    if (!quoteEn || !quoteZh) {
      continue;
    }

    const fingerprint = buildQuoteFingerprint(quoteEn, quoteZh);
    if (fingerprints.has(fingerprint)) {
      skippedDuplicates += 1;
      continue;
    }
    fingerprints.add(fingerprint);

    quoteSources.set(item.sourceId, {
      id: item.sourceId,
      name: item.sourceName,
      baseUrl: extractBaseUrl(item.sourceUrl),
      fetchType: "html",
      isActive: true,
      lastFetchedAt: now,
      createdAt: now,
      updatedAt: now
    });

    quotes.push({
      id: randomUUID(),
      quoteEn,
      quoteZh,
      author: normalizeQuoteText(item.author),
      topic: normalizeQuoteText(item.topic),
      sourceId: item.sourceId,
      sourceUrl: item.sourceUrl,
      rawTitle: normalizeQuoteText(item.rawTitle),
      fingerprint,
      qualityScore: 80,
      isActive: true,
      createdAt: now,
      updatedAt: now
    });
  }

  return {
    quoteSources: [...quoteSources.values()],
    quotes,
    skippedDuplicates
  };
}

export async function ingestQuotes({
  store,
  sources = DEFAULT_QUOTE_SOURCES,
  fetchImpl = fetch,
  now = new Date()
}: {
  store: DataStore;
  sources?: QuoteSourceDefinition[];
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<IngestSummary> {
  const errors: IngestSummary["errors"] = [];
  const parsedItems: ParsedQuote[] = [];
  let fetchedSources = 0;

  for (const source of sources) {
    for (const url of source.urls) {
      try {
        const response = await fetchImpl(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const html = await response.text();
        fetchedSources += 1;
        parsedItems.push(...source.parse(html, url));
      } catch (error) {
        errors.push({
          sourceId: source.id,
          url,
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  }

  const rows = buildIngestRows(parsedItems, now.toISOString());
  if (rows.quoteSources.length) {
    await store.saveQuoteSources(rows.quoteSources);
  }
  if (rows.quotes.length) {
    await store.saveQuotes(rows.quotes);
  }

  return {
    attemptedSources: sources.reduce((count, source) => count + source.urls.length, 0),
    fetchedSources,
    parsedQuotes: parsedItems.length,
    insertedSources: rows.quoteSources.length,
    insertedQuotes: rows.quotes.length,
    skippedDuplicates: rows.skippedDuplicates,
    errors
  };
}

function extractBaseUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return sourceUrl;
  }
}
