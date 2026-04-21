export type HomeQuoteEvent = "advance" | "peek";

export type SelectedHomeQuote = {
  id: string;
  en: string;
  zh: string;
  author: string;
  topic: string;
  dailyIndex: number;
  dailyLimit: number;
};

export type ParsedQuote = {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  quoteEn: string;
  quoteZh: string;
  author: string;
  topic: string;
  rawTitle: string;
};

export type QuoteSourceDefinition = {
  id: string;
  name: string;
  baseUrl: string;
  fetchType: string;
  urls: string[];
  parse(html: string, sourceUrl: string): ParsedQuote[];
};

export type IngestSummary = {
  attemptedSources: number;
  fetchedSources: number;
  parsedQuotes: number;
  insertedSources: number;
  insertedQuotes: number;
  skippedDuplicates: number;
  errors: Array<{
    sourceId: string;
    url: string;
    message: string;
  }>;
};
