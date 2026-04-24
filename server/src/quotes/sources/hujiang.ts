import { extractTextLines, isLikelyChinese, isLikelyEnglish, normalizeQuoteText } from "../normalize";
import type { ParsedQuote, QuoteSourceDefinition } from "./types";

const SOURCE_ID = "hujiang-bilingual";
const SOURCE_NAME = "hujiang-bilingual";

export function extractHjEnglishQuotes(html: string, sourceUrl: string): ParsedQuote[] {
  const title = extractDocumentTitle(html) ?? "hujiang quote";
  const quotes: ParsedQuote[] = [];
  const pairedBlocks = html.matchAll(
    /<div[^>]*class="[^"]*langs_en[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="[^"]*langs_cn[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  );

  for (const match of pairedBlocks) {
    const quoteEn = normalizeQuoteText(match[1] ?? "");
    const quoteZh = normalizeQuoteText(match[2] ?? "");
    if (!isLikelyEnglish(quoteEn) || !isLikelyChinese(quoteZh)) {
      continue;
    }
    quotes.push({
      sourceId: SOURCE_ID,
      sourceName: SOURCE_NAME,
      sourceUrl,
      quoteEn,
      quoteZh,
      author: "",
      topic: "motivation",
      rawTitle: title
    });
  }

  if (quotes.length > 0) {
    return dedupeQuotes(quotes);
  }

  const blocks = html.match(/<(p|li)[\s\S]*?<\/(p|li)>/gi) ?? [];
  for (const block of blocks) {
    const lines = extractTextLines(block);
    for (let index = 0; index < lines.length - 1; index += 1) {
      const quoteEn = normalizeQuoteText(lines[index]);
      const quoteZh = normalizeQuoteText(lines[index + 1]);
      if (!isLikelyEnglish(quoteEn) || !isLikelyChinese(quoteZh)) {
        continue;
      }
      quotes.push({
        sourceId: SOURCE_ID,
        sourceName: SOURCE_NAME,
        sourceUrl,
        quoteEn,
        quoteZh,
        author: "",
        topic: "motivation",
        rawTitle: title
      });
      index += 1;
    }
  }

  return dedupeQuotes(quotes);
}

export const HUJIANG_SOURCE: QuoteSourceDefinition = {
  id: SOURCE_ID,
  name: SOURCE_NAME,
  baseUrl: "https://www.hjenglish.com",
  fetchType: "html",
  urls: [
    "https://www.hjenglish.com/new/p899424/",
    "https://www.hjenglish.com/meiwen/p899289/",
    "https://www.hjenglish.com/new/p173845/",
    "https://www.hjenglish.com/fanyi/p452536/"
  ],
  parse: extractHjEnglishQuotes
};

function extractDocumentTitle(html: string) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  return match ? normalizeQuoteText(match[1]) : null;
}

function dedupeQuotes(quotes: ParsedQuote[]) {
  const seen = new Set<string>();
  return quotes.filter((quote) => {
    const key = `${quote.quoteEn}::${quote.quoteZh}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
