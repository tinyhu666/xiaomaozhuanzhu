export type SessionState = "running" | "paused" | null;
export type SessionAction = "start" | "pause" | "resume" | "complete";

export type CompletionPhoto = {
  fileId: string;
  objectKey: string;
};

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
    message: valid ? "" : "请先上传 1 张学习照片并填写一句话总结"
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
  const leading = (firstDay.getUTCDay() + 6) % 7;
  const cursor = new Date(Date.UTC(year, monthIndex, 1 - leading));
  const items: Array<{
    date: string;
    day: number;
    inMonth: boolean;
    heatLevel: number;
    totalMinutes: number;
  }> = [];

  for (let index = 0; index < 35; index += 1) {
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
