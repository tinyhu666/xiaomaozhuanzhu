import type { DataStore } from "../store/types";
import type { UserDailyQuote } from "../types";
import { DAILY_QUOTE_LIMIT, FALLBACK_QUOTES, FALLBACK_SOURCE } from "./fallback-quotes";
import type { HomeQuoteEvent, SelectedHomeQuote } from "./types";

export async function selectDailyHomeQuote({
  store,
  userId,
  quoteDate,
  now,
  event
}: {
  store: DataStore;
  userId: string;
  quoteDate: string;
  now: string;
  event: HomeQuoteEvent;
}): Promise<SelectedHomeQuote> {
  let dailyQuotes = await ensureDailyQuotes(store, userId, quoteDate, now);
  let visitState = await store.getUserDailyQuoteState(userId, quoteDate);

  if (event === "advance") {
    const nextVisitCount = (visitState?.visitCount ?? 0) + 1;
    visitState = {
      userId,
      quoteDate,
      visitCount: nextVisitCount,
      createdAt: visitState?.createdAt ?? now,
      updatedAt: now
    };
    await store.saveUserDailyQuoteState(visitState);
  }

  const dailyIndex = resolveDailyIndex(visitState?.visitCount ?? 0);
  const slot = dailyQuotes.find((item) => item.slot === dailyIndex) ?? dailyQuotes[0];

  if (!slot) {
    dailyQuotes = await ensureDailyQuotes(store, userId, quoteDate, now);
  }

  const hydratedQuote = await findQuoteById(store, (slot ?? dailyQuotes[0])?.quoteId ?? "");
  if (!hydratedQuote) {
    throw new Error("Unable to resolve a home quote");
  }

  return {
    id: hydratedQuote.id,
    en: hydratedQuote.quoteEn,
    zh: hydratedQuote.quoteZh,
    author: hydratedQuote.author,
    topic: hydratedQuote.topic,
    dailyIndex,
    dailyLimit: DAILY_QUOTE_LIMIT
  };
}

async function ensureDailyQuotes(store: DataStore, userId: string, quoteDate: string, now: string) {
  const existing = (await store.getUserDailyQuotes(userId, quoteDate)).sort((left, right) => left.slot - right.slot);
  if (existing.length >= DAILY_QUOTE_LIMIT) {
    return existing;
  }

  const quotePool = await loadQuotePool(store, now);
  const assigned = quotePool.slice(0, DAILY_QUOTE_LIMIT).map<UserDailyQuote>((quote, index) => ({
    userId,
    quoteDate,
    slot: index + 1,
    quoteId: quote.id,
    createdAt: now
  }));

  await store.replaceUserDailyQuotes(userId, quoteDate, assigned);
  return assigned;
}

async function loadQuotePool(store: DataStore, now: string) {
  let quotes = await store.getActiveQuotes();
  if (quotes.length >= DAILY_QUOTE_LIMIT) {
    return quotes;
  }

  await store.saveQuoteSources([
    {
      ...FALLBACK_SOURCE,
      lastFetchedAt: now,
      updatedAt: now
    }
  ]);
  await store.saveQuotes(
    FALLBACK_QUOTES.map((quote) => ({
      ...quote,
      updatedAt: now
    }))
  );

  quotes = await store.getActiveQuotes();
  if (quotes.length < DAILY_QUOTE_LIMIT) {
    throw new Error("Not enough active quotes to build a daily pool");
  }
  return quotes;
}

async function findQuoteById(store: DataStore, quoteId: string) {
  if (!quoteId) return null;
  const [quote] = await store.getQuotesByIds([quoteId]);
  if (quote) {
    return quote;
  }
  return FALLBACK_QUOTES.find((item) => item.id === quoteId) ?? null;
}

function resolveDailyIndex(visitCount: number) {
  if (visitCount <= 0) {
    return 1;
  }
  if (visitCount <= DAILY_QUOTE_LIMIT) {
    return visitCount;
  }
  return ((visitCount - 1) % DAILY_QUOTE_LIMIT) + 1;
}
