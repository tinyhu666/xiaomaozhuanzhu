import { SHANGHAI_OFFSET_MINUTES } from "../constants";

const OFFSET_MS = SHANGHAI_OFFSET_MINUTES * 60_000;

function shifted(date: Date) {
  return new Date(date.getTime() + OFFSET_MS);
}

export function formatShanghaiDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const local = shifted(date);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthBounds(month: string) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1) - OFFSET_MS);
  const end = new Date(Date.UTC(year, monthIndex + 1, 1) - OFFSET_MS - 1);
  return { start, end };
}

export function startOfNextShanghaiDay(date: Date) {
  const local = shifted(date);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - OFFSET_MS);
}

export function addShanghaiDays(dateKey: string, amount: number) {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const raw = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)) + OFFSET_MS);
  raw.setUTCDate(raw.getUTCDate() + amount);
  return formatShanghaiDate(new Date(raw.getTime() - OFFSET_MS));
}

