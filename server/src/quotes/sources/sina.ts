import { extractTextLines, isLikelyChinese, isLikelyEnglish, normalizeQuoteText } from "../normalize";
import type { ParsedQuote, QuoteSourceDefinition } from "./types";

const SOURCE_ID = "sina-education";
const SOURCE_NAME = "sina-education";

export function extractSinaQuotes(html: string, sourceUrl: string): ParsedQuote[] {
  const title = extractDocumentTitle(html) ?? "sina quote";
  const blocks = html.match(/<p[\s\S]*?<\/p>/gi) ?? [];
  const quotes: ParsedQuote[] = [];

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

export const SINA_SOURCE: QuoteSourceDefinition = {
  id: SOURCE_ID,
  name: SOURCE_NAME,
  baseUrl: "https://edu.sina.com.cn",
  fetchType: "html",
  urls: [
    "https://edu.sina.com.cn/en/2010-08-17/161957122.shtml",
    "https://edu.sina.com.cn/en/2015-12-18/doc-ifxmszek7223369.shtml",
    "https://edu.sina.com.cn/en/2013-03-27/104873142.shtml"
  ],
  parse: extractSinaQuotes
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
