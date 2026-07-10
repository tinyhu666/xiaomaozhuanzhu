/**
 * CPA 注册会计师考试日期表。
 *
 * 中国国内 CPA 专业阶段考试每年由 CICPA 在 3-4 月公布。各年时间一般
 * 落在 8 月的某个周末，且呈现：
 *   周六：会计、税法、经济法
 *   周日：审计、财管、战略
 * 综合阶段考试也排在同一周末。
 *
 * 政策：若当前年度的官方时间已出，使用官方；否则降级到上一年的同
 * 月同日并把年份替换为当前年（业务方在路线图里这样要求 — 给用户
 * 一个粗略 anchor，等官方公告出来后我们立刻更新 EXAM_DATES）。
 */
import type { Subject } from "../constants";

type SubjectDateMap = Record<Subject, string>; // ISO date "YYYY-MM-DD"

export const EXAM_DATES: Record<number, SubjectDateMap> = {
  // 官方公告：2024 年 8 月 24-25 日
  2024: {
    "会计": "2024-08-24",
    "税法": "2024-08-24",
    "经济法": "2024-08-24",
    "审计": "2024-08-25",
    "财管": "2024-08-25",
    "战略": "2024-08-25"
  },
  // 官方公告：2025 年 8 月 23-24 日
  2025: {
    "会计": "2025-08-23",
    "税法": "2025-08-23",
    "经济法": "2025-08-23",
    "审计": "2025-08-24",
    "财管": "2025-08-24",
    "战略": "2025-08-24"
  },
  // 官方公告（中注协）：2026 年 8 月 29-30 日
  //   周六 8/29：会计、税法、经济法；周日 8/30：审计、财管、战略
  2026: {
    "会计": "2026-08-29",
    "税法": "2026-08-29",
    "经济法": "2026-08-29",
    "审计": "2026-08-30",
    "财管": "2026-08-30",
    "战略": "2026-08-30"
  }
};

export type ExamDateInfo = {
  subject: Subject;
  date: string;         // YYYY-MM-DD
  daysRemaining: number;
  fallback: boolean;    // true if we derived from prior year because current year not announced yet
  sourceYear: number;   // which year's official schedule we used
};

/**
 * Returns the exam date for every subject relative to `now`.
 * If current year's dates aren't yet listed in EXAM_DATES, fall back
 * to the most recent prior-year listing and shift the year to "now".
 * If even the prior fallback is in the past, we roll forward by one
 * year (so users opening the app post-exam still see a future date).
 */
export function getExamSchedule(now: Date = new Date()): ExamDateInfo[] {
  const todayKey = formatDateUtc(now);
  const currentYear = now.getUTCFullYear();

  // Find best official source: this year, else most recent prior year.
  const years = Object.keys(EXAM_DATES).map(Number).sort((a, b) => b - a);

  const subjects: Subject[] = ["会计", "审计", "税法", "财管", "经济法", "战略"];

  return subjects.map((subject) => {
    let date = "";
    let sourceYear = 0;
    let fallback = false;

    // 1) Direct hit on current year
    if (EXAM_DATES[currentYear]?.[subject]) {
      date = EXAM_DATES[currentYear][subject];
      sourceYear = currentYear;
    } else {
      // 2) Fall back to most recent prior official, swap year to current
      for (const year of years) {
        if (year < currentYear && EXAM_DATES[year]?.[subject]) {
          const officialDate = EXAM_DATES[year][subject];
          date = currentYear + officialDate.slice(4);
          sourceYear = year;
          fallback = true;
          break;
        }
      }
    }

    // 3) If date is already past, roll forward one year (best effort:
    //    same month-day next year). For subjects whose current-year date
    //    has already happened, the user still gets a meaningful
    //    countdown to *next* year's exam.
    if (date && date < todayKey) {
      const nextYear = currentYear + 1;
      date = nextYear + date.slice(4);
      // fallback stays whatever it was (still derived, not official)
      fallback = true;
    }

    return {
      subject,
      date,
      daysRemaining: date ? daysBetween(todayKey, date) : 0,
      fallback,
      sourceYear
    };
  });
}

function formatDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T00:00:00Z`).getTime();
  const to = new Date(`${toKey}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}
