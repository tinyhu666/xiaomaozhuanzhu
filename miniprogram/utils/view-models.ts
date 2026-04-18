export type SessionState = "running" | "paused" | null;
export type SessionAction = "start" | "pause" | "resume" | "complete";

export type CompletionPhoto = {
  fileId: string;
  objectKey: string;
};

const DAILY_QUOTES = [
  { en: "One page at a time.", zh: "一页一页，也是在前进。" },
  { en: "Stay with the problem.", zh: "沉住气，题会慢慢松动。" },
  { en: "Small progress is still progress.", zh: "学得慢一点，也是往前。" },
  { en: "Calm work adds up.", zh: "安静地学，分数会慢慢长出来。" },
  { en: "Keep the promise to today.", zh: "先把今天答应自己的事情做完。" },
  { en: "Focus makes the page lighter.", zh: "专注一点，书页就没那么重了。" }
] as const;

export function getSessionActions(state: SessionState): SessionAction[] {
  if (state === "running") {
    return ["pause", "complete"];
  }
  if (state === "paused") {
    return ["resume", "complete"];
  }
  return ["start"];
}

export function validateCompletionDraft(draft: { summary: string; photos: CompletionPhoto[] }) {
  const valid = draft.summary.trim().length > 0 && draft.photos.length >= 1;
  return {
    valid,
    message: valid ? "" : "请先上传 1 张学习照片，并填写一句话总结"
  };
}

export function buildMonthGrid(
  month: string,
  dailyStats: Record<string, { totalMinutes: number; heatLevel: number }>
) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  const leading = (firstDay.getUTCDay() + 6) % 7;
  const trailing = (7 - ((lastDay.getUTCDay() + 6) % 7) - 1 + 7) % 7;
  const totalCells = leading + lastDay.getUTCDate() + trailing;
  const cursor = new Date(Date.UTC(year, monthIndex, 1 - leading));
  const items: Array<{
    date: string;
    day: number;
    inMonth: boolean;
    heatLevel: number;
    totalMinutes: number;
  }> = [];

  for (let index = 0; index < totalCells; index += 1) {
    const date = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    const stat = dailyStats[date];
    items.push({
      date,
      day: cursor.getUTCDate(),
      inMonth: cursor.getUTCMonth() === monthIndex,
      heatLevel: stat?.heatLevel ?? 0,
      totalMinutes: stat?.totalMinutes ?? 0
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return items;
}

export function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function getDailyQuote(dateKey: string) {
  const day = Number(dateKey.split("-")[2] ?? "1");
  return DAILY_QUOTES[Math.max(day, 1) % DAILY_QUOTES.length];
}

export function buildSubjectSummary(items: Array<{ subject: string; totalMinutes: number }>) {
  return [...items]
    .sort((left, right) => right.totalMinutes - left.totalMinutes)
    .map((item) => ({
      ...item,
      durationText: formatDuration(item.totalMinutes)
    }));
}

export function buildAuthorizedProfile(profile: { nickName: string; avatarUrl: string }) {
  return {
    nickname: profile.nickName.trim() || "CPA考生",
    avatarUrl: profile.avatarUrl.replace(/\/132$/, "/0")
  };
}
