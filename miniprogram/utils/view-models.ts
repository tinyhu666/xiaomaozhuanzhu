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
  { en: "Focus makes the page lighter.", zh: "专注一点，书页就没那么重了。" },
  { en: "Show up first, the rest follows.", zh: "先坐下来，状态才会找上你。" },
  { en: "Tired is fine. Quitting is not.", zh: "累没关系，停了就可惜。" },
  { en: "The best time to start is the next 25 minutes.", zh: "下一个 25 分钟，就是最好的开始。" },
  { en: "Trust the long arc.", zh: "相信长期主义，分数不会辜负时间。" },
  { en: "Confused now, clearer later.", zh: "今天看不懂没关系，明天会再亮一点。" },
  { en: "Slow is smooth, smooth is fast.", zh: "慢就是稳，稳就是快。" },
  { en: "Done beats perfect.", zh: "完成比完美重要。" },
  { en: "Today's hour, tomorrow's confidence.", zh: "今天多一小时，明天就多一分底气。" },
  { en: "Forget the noise. Start the next problem.", zh: "别管别人，把下一题做完。" },
  { en: "Knowledge compounds. So does effort.", zh: "知识会复利，努力也会。" },
  { en: "You don't need to feel ready.", zh: "别等准备好，先开始。" },
  { en: "Tiny streaks beat heroic days.", zh: "每天一点点，比偶尔一大把更顶用。" },
  { en: "Mistakes today are progress tomorrow.", zh: "今天写错的，明天就是会的。" },
  { en: "Sit down. Open the book. The rest is easy.", zh: "坐下，翻开书，剩下的事自然会发生。" },
  { en: "Be the calm one.", zh: "做那个稳得住的人。" },
  { en: "Discipline is freedom in disguise.", zh: "规律是你换来自由的代价，也是奖励。" },
  { en: "Tired, but still here.", zh: "再累，也还在自己的位置上。" },
  { en: "Quiet effort, loud results.", zh: "默默用功，分数会替你说话。" }
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
  dailyStats: Record<string, { totalMinutes: number; heatLevel: number }>,
  todayDate?: string
) {
  const safeMonth = typeof month === "string" ? month : "";
  const [yearText, monthText] = safeMonth.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return [] as Array<{
      date: string;
      day: number;
      inMonth: boolean;
      heatLevel: number;
      totalMinutes: number;
      isToday: boolean;
    }>;
  }
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  const leading = (firstDay.getUTCDay() + 6) % 7;
  const trailing = (7 - ((lastDay.getUTCDay() + 6) % 7) - 1 + 7) % 7;
  const totalCells = leading + lastDay.getUTCDate() + trailing;
  const cursor = new Date(Date.UTC(year, monthIndex, 1 - leading));
  const today =
    todayDate ??
    (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
      ).padStart(2, "0")}`;
    })();
  const items: Array<{
    date: string;
    day: number;
    inMonth: boolean;
    heatLevel: number;
    totalMinutes: number;
    isToday: boolean;
  }> = [];

  for (let index = 0; index < totalCells; index += 1) {
    const date = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    const stat = dailyStats[date];
    items.push({
      date,
      day: cursor.getUTCDate(),
      inMonth: cursor.getUTCMonth() === monthIndex,
      heatLevel: stat?.heatLevel ?? 0,
      totalMinutes: stat?.totalMinutes ?? 0,
      isToday: date === today
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

export function getDailyQuote(dateKey?: string) {
  const key =
    dateKey ??
    (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
      ).padStart(2, "0")}`;
    })();
  // Stable hash so the same calendar day always shows the same quote.
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return DAILY_QUOTES[hash % DAILY_QUOTES.length];
}

export function buildSubjectSummary(items: Array<{ subject: string; totalMinutes: number }>) {
  return [...items]
    .sort((left, right) => right.totalMinutes - left.totalMinutes)
    .map((item) => ({
      ...item,
      durationText: formatDuration(item.totalMinutes)
    }));
}

export function buildSubjectProgress(items: Array<{ subject: string; totalMinutes: number; targetMinutes?: number }>) {
  return [...items]
    .sort((left, right) => {
      const leftProgress = left.targetMinutes ? left.totalMinutes / left.targetMinutes : 0;
      const rightProgress = right.targetMinutes ? right.totalMinutes / right.targetMinutes : 0;
      return rightProgress - leftProgress;
    })
    .map((item) => {
      const target = item.targetMinutes ?? 0;
      const progress = target > 0 ? Math.min(1, item.totalMinutes / target) : 0;
      return {
        ...item,
        progress,
        progressPercent: Math.round(progress * 100),
        durationText: formatDuration(item.totalMinutes),
        targetText: target > 0 ? `${Math.round(target / 60)}h` : "",
        reached: target > 0 && item.totalMinutes >= target
      };
    });
}
