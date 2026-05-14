// @ts-nocheck
import type { ExamDateInfo, ProfileDashboardResponse, SubjectProgress } from "../../types/models";
import { getProfileDashboard } from "../../utils/api";
import { formatDuration } from "../../utils/view-models";

type SubjectView = {
  subject: string;
  totalMinutes: number;
  targetMinutes: number;
  progressPct: number;
  totalText: string;
  targetText: string;
  reached: boolean;
  daysRemaining: number;
  examDateLabel: string;
  fallback: boolean;
};

type DonutSegment = {
  subject: string;
  color: string;
  totalMinutes: number;
  totalText: string;
  percent: number;
};

type SubjectsPageData = {
  subjects: SubjectView[];
  overallPct: number;
  totalText: string;
  nextDaysRemaining: number;
  anyFallback: boolean;
  donut: {
    hasData: boolean;
    style: string;
    centerLabel: string;
    centerSub: string;
    segments: DonutSegment[];
  };
};

const TOTAL_TARGET_MINUTES = 1220 * 60; // 总学时 ≈ 1220h

/**
 * Stable, accessible color palette for the six subjects.
 * Ordered to roughly match the SUBJECTS index in constants.ts:
 *   0 会计 · 1 审计 · 2 税法 · 3 财管 · 4 经济法 · 5 战略
 * The palette pairs each subject with a hue that's distinct from
 * its neighbors and doesn't fight the page's mint base layer.
 */
const SUBJECT_COLORS: Record<string, string> = {
  会计: "#2ea985",
  审计: "#4a6ed9",
  税法: "#e57b2b",
  财管: "#c4569f",
  经济法: "#3eb0c8",
  战略: "#d9a536"
};

Page<{}, SubjectsPageData>({
  data: {
    subjects: [],
    overallPct: 0,
    totalText: "0m",
    nextDaysRemaining: 0,
    anyFallback: false,
    donut: { hasData: false, style: "", centerLabel: "", centerSub: "", segments: [] }
  },

  async onLoad() {
    await this.refresh();
  },

  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },

  async refresh() {
    wx.showNavigationBarLoading();
    try {
      const dashboard = (await getProfileDashboard()) as ProfileDashboardResponse;
      // subjectTargets is the full 6-subject list with target + actual.
      // Each subject in `subjects` (only those with > 0 minutes) is a
      // subset; we use subjectTargets so users see all 6 cards even
      // when they haven't started a subject yet.
      const allSubjects = (dashboard.subjectTargets ?? dashboard.subjects ?? []) as SubjectProgress[];
      const schedule = (dashboard.examSchedule ?? []) as ExamDateInfo[];
      const examBySubject = new Map<string, ExamDateInfo>(schedule.map((e) => [e.subject, e]));

      const subjects: SubjectView[] = allSubjects.map((s) => {
        const target = s.targetMinutes ?? 0;
        const total = s.totalMinutes ?? 0;
        const progress = target > 0 ? Math.min(1, total / target) : 0;
        const exam = examBySubject.get(s.subject);
        return {
          subject: s.subject,
          totalMinutes: total,
          targetMinutes: target,
          progressPct: Math.round(progress * 100),
          totalText: formatDuration(total),
          targetText: target > 0 ? `${Math.round(target / 60)}h` : "—",
          reached: target > 0 && total >= target,
          daysRemaining: exam?.daysRemaining ?? 0,
          examDateLabel: exam ? formatExamDate(exam.date) : "—",
          fallback: !!exam?.fallback
        };
      });

      // Sort by exam date (soonest first), tie-break by less progress
      // (more urgent), so users see the most pressing subject on top.
      subjects.sort((a, b) => {
        if (a.daysRemaining !== b.daysRemaining) return a.daysRemaining - b.daysRemaining;
        return a.progressPct - b.progressPct;
      });

      const totalMinutes = subjects.reduce((sum, s) => sum + s.totalMinutes, 0);
      const overallPct = Math.round((totalMinutes / TOTAL_TARGET_MINUTES) * 100);
      const nextDaysRemaining = subjects.length ? subjects[0].daysRemaining : 0;
      const anyFallback = subjects.some((s) => s.fallback);

      this.setData({
        subjects,
        overallPct,
        totalText: formatDuration(totalMinutes),
        nextDaysRemaining,
        anyFallback,
        donut: buildSubjectDonut(subjects, totalMinutes)
      });
    } catch (error) {
      console.error("[subjects] dashboard failed", error);
      wx.showToast({
        title: error instanceof Error ? error.message : "加载失败",
        icon: "none"
      });
    } finally {
      wx.hideNavigationBarLoading();
    }
  }
});

/**
 * Build the donut view-model from the subject cards. Uses CSS
 * `conic-gradient` for the ring itself (no SVG / canvas needed) plus
 * a smaller white disc on top to carve out the "hole". The legend is
 * the same SubjectView ordering as the cards below — clicking the
 * legend doesn't navigate (deliberate; the card list already does
 * everything a tap would need).
 *
 * `centerLabel` shows the total time, `centerSub` shows the percent
 * of the 1220h CPA total — so the donut answers two questions: how
 * is my time split across subjects, AND how far am I overall.
 */
function buildSubjectDonut(subjects: SubjectView[], totalMinutes: number) {
  // Filter to only subjects that have time on them; an empty wedge
  // for "战略 0m" would just clutter the legend.
  const active = subjects.filter((s) => s.totalMinutes > 0);
  if (!active.length || totalMinutes <= 0) {
    return {
      hasData: false,
      style: "",
      centerLabel: "—",
      centerSub: "尚未开始记录",
      segments: []
    };
  }

  // Sort segments by minutes desc for a more readable conic-gradient.
  const sorted = [...active].sort((a, b) => b.totalMinutes - a.totalMinutes);

  let cumulative = 0;
  const stops: string[] = [];
  const segments: DonutSegment[] = [];
  for (const subject of sorted) {
    const percent = (subject.totalMinutes / totalMinutes) * 100;
    const color = SUBJECT_COLORS[subject.subject] ?? "#2ea985";
    const start = cumulative;
    cumulative += percent;
    // Conic-gradient stops are inclusive on the start, exclusive on
    // the end — leaving them at integer % values avoids hairline
    // seams between segments on rasterization.
    stops.push(`${color} ${start.toFixed(2)}% ${cumulative.toFixed(2)}%`);
    segments.push({
      subject: subject.subject,
      color,
      totalMinutes: subject.totalMinutes,
      totalText: formatDuration(subject.totalMinutes),
      percent: Math.round(percent)
    });
  }

  const overallPercent = Math.round((totalMinutes / TOTAL_TARGET_MINUTES) * 100);
  return {
    hasData: true,
    style: `background: conic-gradient(${stops.join(", ")});`,
    centerLabel: formatDuration(totalMinutes),
    centerSub: `已学 ${overallPercent}% 总目标`,
    segments
  };
}

function formatExamDate(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(iso + "T08:00:00+08:00");
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日（周${weekdays[d.getDay()]}）`;
}
