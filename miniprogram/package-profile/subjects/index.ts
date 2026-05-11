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

type SubjectsPageData = {
  subjects: SubjectView[];
  overallPct: number;
  totalText: string;
  nextDaysRemaining: number;
  anyFallback: boolean;
};

const TOTAL_TARGET_MINUTES = 1220 * 60; // 总学时 ≈ 1220h

Page<{}, SubjectsPageData>({
  data: {
    subjects: [],
    overallPct: 0,
    totalText: "0m",
    nextDaysRemaining: 0,
    anyFallback: false
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
        anyFallback
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

function formatExamDate(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(iso + "T08:00:00+08:00");
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日（周${weekdays[d.getDay()]}）`;
}
