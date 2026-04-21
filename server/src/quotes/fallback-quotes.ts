import type { Quote, QuoteSource } from "../types";

export const DAILY_QUOTE_LIMIT = 5;
export const FALLBACK_SOURCE_ID = "seed-motivation";

export const FALLBACK_SOURCE: QuoteSource = {
  id: FALLBACK_SOURCE_ID,
  name: "builtin-seed",
  baseUrl: "https://example.com/quotes",
  fetchType: "seed",
  isActive: true,
  lastFetchedAt: null,
  createdAt: "2026-04-21T00:00:00.000Z",
  updatedAt: "2026-04-21T00:00:00.000Z"
};

export const FALLBACK_QUOTES: Quote[] = [
  {
    id: "seed-quote-1",
    quoteEn: "Success is the sum of small efforts repeated every day.",
    quoteZh: "成功是把微小的努力，一天一天地重复下去。",
    author: "Robert Collier",
    topic: "discipline",
    sourceId: FALLBACK_SOURCE_ID,
    sourceUrl: "https://example.com/quotes/1",
    rawTitle: "fallback quote 1",
    fingerprint: "seed-quote-1",
    qualityScore: 100,
    isActive: true,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z"
  },
  {
    id: "seed-quote-2",
    quoteEn: "The future depends on what you do today.",
    quoteZh: "未来取决于你今天做了什么。",
    author: "Mahatma Gandhi",
    topic: "focus",
    sourceId: FALLBACK_SOURCE_ID,
    sourceUrl: "https://example.com/quotes/2",
    rawTitle: "fallback quote 2",
    fingerprint: "seed-quote-2",
    qualityScore: 99,
    isActive: true,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z"
  },
  {
    id: "seed-quote-3",
    quoteEn: "Great things are done by a series of small things brought together.",
    quoteZh: "伟大的事情，往往由许多微小的事情汇聚而成。",
    author: "Vincent van Gogh",
    topic: "consistency",
    sourceId: FALLBACK_SOURCE_ID,
    sourceUrl: "https://example.com/quotes/3",
    rawTitle: "fallback quote 3",
    fingerprint: "seed-quote-3",
    qualityScore: 98,
    isActive: true,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z"
  },
  {
    id: "seed-quote-4",
    quoteEn: "Do something today that your future self will thank you for.",
    quoteZh: "今天多做一点，未来的你会感谢现在的自己。",
    author: "Sean Patrick Flanery",
    topic: "effort",
    sourceId: FALLBACK_SOURCE_ID,
    sourceUrl: "https://example.com/quotes/4",
    rawTitle: "fallback quote 4",
    fingerprint: "seed-quote-4",
    qualityScore: 97,
    isActive: true,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z"
  },
  {
    id: "seed-quote-5",
    quoteEn: "It always seems impossible until it is done.",
    quoteZh: "很多事看起来不可能，直到你真正做成它。",
    author: "Nelson Mandela",
    topic: "perseverance",
    sourceId: FALLBACK_SOURCE_ID,
    sourceUrl: "https://example.com/quotes/5",
    rawTitle: "fallback quote 5",
    fingerprint: "seed-quote-5",
    qualityScore: 96,
    isActive: true,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z"
  },
  {
    id: "seed-quote-6",
    quoteEn: "Little by little, a little becomes a lot.",
    quoteZh: "一点一点积累，终会从微小走向丰盛。",
    author: "Tanzanian Proverb",
    topic: "growth",
    sourceId: FALLBACK_SOURCE_ID,
    sourceUrl: "https://example.com/quotes/6",
    rawTitle: "fallback quote 6",
    fingerprint: "seed-quote-6",
    qualityScore: 95,
    isActive: true,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z"
  }
];
