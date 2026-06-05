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

/**
 * v0.24 — photo + summary are optional. The only client-side guards
 * left are length / count caps (server enforces too, but rejecting
 * early avoids a round-trip). Submitting an empty form is allowed
 * and intentional: the user gets a session row recorded as having
 * happened, even without a photo or text. Cuts the 7-tap completion
 * path down to 3 taps for users who don't want to journal.
 */
export function validateCompletionDraft(draft: { summary: string; photos: CompletionPhoto[] }) {
  if (draft.summary.length > 80) {
    return { valid: false, message: "总结最多 80 字" };
  }
  if (draft.photos.length > 3) {
    return { valid: false, message: "最多上传 3 张照片" };
  }
  return { valid: true, message: "" };
}

/**
 * Compact label for inside heat-map cells (small space):
 *   < 60 min  → "Xm"  (e.g. "45m")
 *   ≥ 60 min  → "Xh"  for whole hours, otherwise "X.Yh" (e.g. "1h", "2.5h")
 */
export function formatHeatLabel(totalMinutes: number) {
  if (!totalMinutes || totalMinutes <= 0) return "";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = totalMinutes / 60;
  if (Number.isInteger(hours)) return `${hours}h`;
  if (hours >= 10) return `${Math.round(hours)}h`;
  // One decimal for sub-10h (e.g. 1.5h, 2.3h).
  return `${Math.round(hours * 10) / 10}h`;
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
      heatLabel: string;
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
    heatLabel: string;
    isToday: boolean;
  }> = [];

  for (let index = 0; index < totalCells; index += 1) {
    const date = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    const stat = dailyStats[date];
    const totalMinutes = stat?.totalMinutes ?? 0;
    items.push({
      date,
      day: cursor.getUTCDate(),
      inMonth: cursor.getUTCMonth() === monthIndex,
      heatLevel: stat?.heatLevel ?? 0,
      totalMinutes,
      heatLabel: formatHeatLabel(totalMinutes),
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

/**
 * Picks a quote for the home card. Strategy:
 *   - Cycles through all 24 lines so each entry feels fresh.
 *   - Persists the last-shown index via wx.setStorageSync so we never
 *     repeat the immediately-previous quote, even after the user kills
 *     the miniprogram.
 *   - Falls back to a date-stable hash when wx is unavailable (Node
 *     test environment) so existing tests stay deterministic.
 *
 * The `dateKey` parameter is preserved as a deterministic seed for
 * tests; in normal miniprogram runtime it's ignored in favor of the
 * persisted index.
 */
const QUOTE_LAST_INDEX_KEY = "cpa.lastQuoteIndex";

declare const wx: { getStorageSync(key: string): unknown; setStorageSync(key: string, value: unknown): void } | undefined;

function readPersistedQuoteIndex(): number {
  try {
    if (typeof wx === "undefined") return -1;
    const value = wx.getStorageSync(QUOTE_LAST_INDEX_KEY);
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < DAILY_QUOTES.length) {
      return value;
    }
  } catch {
    // ignore — storage unavailable
  }
  return -1;
}

function persistQuoteIndex(index: number) {
  try {
    if (typeof wx === "undefined") return;
    wx.setStorageSync(QUOTE_LAST_INDEX_KEY, index);
  } catch {
    // ignore — storage may be full or unavailable
  }
}

export function getDailyQuote(dateKey?: string) {
  const total = DAILY_QUOTES.length;
  if (total <= 1) return DAILY_QUOTES[0];

  // Test path: when wx is unavailable, behave deterministically off
  // the dateKey so existing assertions still pass.
  if (typeof wx === "undefined") {
    const key =
      dateKey ??
      (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
          now.getDate()
        ).padStart(2, "0")}`;
      })();
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
    }
    return DAILY_QUOTES[hash % total];
  }

  // Runtime path: pick a fresh index that's not the immediately-
  // previous one. Since the user complained the same line stuck for
  // multiple entries, "always different from last" is the minimum
  // viable randomness.
  const last = readPersistedQuoteIndex();
  let next = Math.floor(Math.random() * total);
  if (last >= 0 && next === last) {
    next = (next + 1) % total;
  }
  persistQuoteIndex(next);
  return DAILY_QUOTES[next];
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

/* ============================================================
 * v0.33 — B1 科目 × 考期 平衡复盘 (subject-time vs exam-urgency).
 *
 * The single most useful judgment for a 6-subject CPA candidate:
 * "am I spending time on the subjects that need it, given how close
 * each exam is?" Joins each subject's invested-vs-target minutes with
 * the days remaining until THAT subject's exam, and ranks by how
 * behind/urgent it is. Pure function — fully unit-tested. The data
 * (subjectTargets + examSchedule) already flows from /me/dashboard,
 * so this needs zero server/schema change.
 * ============================================================ */
export type SubjectBalanceTier = "reached" | "ontrack" | "behind" | "urgent";

export type SubjectBalanceItem = {
  subject: string;
  totalMinutes: number;
  targetMinutes: number;
  daysRemaining: number;
  remainingMinutes: number;
  /** Minutes/day needed from now to hit target by this subject's exam. */
  requiredDailyMinutes: number;
  progressPercent: number;
  tier: SubjectBalanceTier;
  hint: string;
  durationText: string;
};

const SUBJECT_BALANCE_TIER_ORDER: Record<SubjectBalanceTier, number> = {
  urgent: 0,
  behind: 1,
  ontrack: 2,
  reached: 3
};

export function buildSubjectBalance(
  subjectTargets: Array<{ subject: string; totalMinutes: number; targetMinutes?: number }>,
  examSchedule: Array<{ subject: string; daysRemaining: number }> = []
): SubjectBalanceItem[] {
  const daysBySubject = new Map(examSchedule.map((entry) => [entry.subject, entry.daysRemaining]));

  return subjectTargets
    .map((item) => {
      const target = item.targetMinutes ?? 0;
      const total = Math.max(0, item.totalMinutes ?? 0);
      const daysRemaining = Math.max(0, daysBySubject.get(item.subject) ?? 0);
      const remainingMinutes = Math.max(0, target - total);
      const progressPercent = target > 0 ? Math.min(100, Math.round((total / target) * 100)) : 0;
      // When the exam is here (0 days) but work remains, the whole gap
      // is "today" — divide by 1, not 0.
      const requiredDailyMinutes =
        remainingMinutes === 0 ? 0 : Math.ceil(remainingMinutes / Math.max(1, daysRemaining));

      let tier: SubjectBalanceTier;
      let hint: string;
      if (target > 0 && total >= target) {
        tier = "reached";
        hint = "投入已达目标";
      } else if (daysRemaining > 0 && daysRemaining <= 7 && remainingMinutes > 0) {
        tier = "urgent";
        hint = `距考仅 ${daysRemaining} 天，需 ${requiredDailyMinutes} 分钟/天`;
      } else if (requiredDailyMinutes >= 120) {
        tier = "urgent";
        hint = `落后较多，需 ${requiredDailyMinutes} 分钟/天`;
      } else if (requiredDailyMinutes >= 45) {
        tier = "behind";
        hint = `需 ${requiredDailyMinutes} 分钟/天 达标`;
      } else {
        tier = "ontrack";
        hint = requiredDailyMinutes > 0 ? `按 ${requiredDailyMinutes} 分钟/天 可达标` : "进度良好";
      }

      return {
        subject: item.subject,
        totalMinutes: total,
        targetMinutes: target,
        daysRemaining,
        remainingMinutes,
        requiredDailyMinutes,
        progressPercent,
        tier,
        hint,
        durationText: formatDuration(total)
      };
    })
    .sort((left, right) => {
      const tierDiff = SUBJECT_BALANCE_TIER_ORDER[left.tier] - SUBJECT_BALANCE_TIER_ORDER[right.tier];
      if (tierDiff !== 0) return tierDiff;
      // Within a tier, the one needing more minutes/day is more pressing.
      return right.requiredDailyMinutes - left.requiredDailyMinutes;
    });
}

/* ============================================================
 * v0.36 — B3 状态聚合 (effectiveness aggregation). The 顺利/卡住/高效
 * tags the user attaches to sessions are recorded but never analyzed.
 * This aggregates, per subject, how much study time was tagged 卡住
 * (stuck) vs 顺利/高效 (smooth), so the user can see "财管 60% 卡住 →
 * change approach". Pure function — unit-tested. Feeds the 复盘 page.
 * ============================================================ */
const STUCK_TAG = "卡住";
const SMOOTH_TAGS = ["顺利", "高效"];

export type SubjectEffectivenessItem = {
  subject: string;
  totalMinutes: number;
  stuckMinutes: number;
  smoothMinutes: number;
  stuckPercent: number;
  /** "needs-attention" when stuck share is high enough to flag. */
  flagged: boolean;
  hint: string;
};

export function buildEffectivenessBySubject(
  sessions: Array<{ subject: string | null; durationMinutes: number; tags?: string[] }>
): SubjectEffectivenessItem[] {
  const bySubject = new Map<string, { total: number; stuck: number; smooth: number }>();

  for (const session of sessions) {
    const subject = session.subject;
    if (!subject) continue;
    const minutes = Math.max(0, session.durationMinutes ?? 0);
    if (minutes <= 0) continue;
    const tags = session.tags ?? [];
    const entry = bySubject.get(subject) ?? { total: 0, stuck: 0, smooth: 0 };
    entry.total += minutes;
    if (tags.includes(STUCK_TAG)) entry.stuck += minutes;
    if (tags.some((tag) => SMOOTH_TAGS.includes(tag))) entry.smooth += minutes;
    bySubject.set(subject, entry);
  }

  return [...bySubject.entries()]
    .map(([subject, agg]) => {
      const stuckPercent = agg.total > 0 ? Math.round((agg.stuck / agg.total) * 100) : 0;
      let flagged = false;
      let hint: string;
      if (stuckPercent >= 50) {
        flagged = true;
        hint = "卡住偏多，考虑换方法或加时间";
      } else if (stuckPercent >= 25) {
        flagged = true;
        hint = "有些卡顿，留意一下";
      } else if (agg.smooth > 0) {
        hint = "状态不错";
      } else {
        hint = "";
      }
      return {
        subject,
        totalMinutes: agg.total,
        stuckMinutes: agg.stuck,
        smoothMinutes: agg.smooth,
        stuckPercent,
        flagged,
        hint
      };
    })
    .sort((left, right) => right.stuckPercent - left.stuckPercent);
}
