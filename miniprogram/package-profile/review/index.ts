// @ts-nocheck
import type { ExamDateInfo, ProfileDashboardResponse, SubjectProgress } from "../../types/models";
import { getProfileDashboard, listMySessions } from "../../utils/api";
import {
  buildEffectivenessBySubject,
  buildSubjectBalance,
  type SubjectBalanceItem,
  type SubjectEffectivenessItem
} from "../../utils/view-models";

/**
 * v0.33 — B1 学习复盘 · 科目 × 考期 平衡。
 *
 * The flagship 复盘 surface: answers "am I spending time on the
 * subjects that need it, given how close each exam is?" Pure read of
 * /me/dashboard (subjectTargets + examSchedule already flow); the
 * ranking math lives in view-models.buildSubjectBalance (unit-tested).
 * No new server endpoint, no schema change.
 */
type ReviewPageData = {
  loadState: "loading" | "loaded" | "error";
  items: SubjectBalanceItem[];
  urgentCount: number;
  behindCount: number;
  headline: string;
  subhead: string;
  /** v0.36 — B3 状态聚合: subjects with a notable 卡住 share. */
  effectiveness: SubjectEffectivenessItem[];
};

Page<{}, ReviewPageData>({
  data: {
    loadState: "loading",
    items: [],
    urgentCount: 0,
    behindCount: 0,
    headline: "",
    subhead: "",
    effectiveness: []
  },

  async onLoad() {
    await this.refresh();
  },

  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },

  retryLoad() {
    this.refresh();
  },

  async refresh() {
    this.setData({ loadState: "loading" });
    wx.showNavigationBarLoading();
    try {
      // Dashboard drives B1 balance; sessions drive B3 effectiveness.
      // Sessions degrade gracefully (B3 section just hides on failure).
      const [dashboard, sessionsRes] = await Promise.all([
        getProfileDashboard() as Promise<ProfileDashboardResponse>,
        listMySessions().catch((err) => {
          console.warn("[review] sessions fetch failed", err);
          return null;
        })
      ]);
      // subjectTargets = all 6 subjects (incl. 0-minute ones); fall back
      // to subjects if an older server build omits it.
      const allSubjects = (dashboard.subjectTargets ?? dashboard.subjects ?? []) as SubjectProgress[];
      const schedule = (dashboard.examSchedule ?? []) as ExamDateInfo[];

      const TIER_LABEL = { urgent: "紧迫", behind: "落后", ontrack: "在轨", reached: "达标" };
      const items = buildSubjectBalance(
        allSubjects.map((s) => ({
          subject: s.subject,
          totalMinutes: s.totalMinutes ?? 0,
          targetMinutes: s.targetMinutes ?? 0
        })),
        schedule.map((e) => ({ subject: e.subject, daysRemaining: e.daysRemaining }))
      ).map((item) => ({
        ...item,
        tierLabel: TIER_LABEL[item.tier] ?? "",
        targetText: item.targetMinutes > 0 ? `${Math.round(item.targetMinutes / 60)}h` : "—"
      }));

      const urgentCount = items.filter((i) => i.tier === "urgent").length;
      const behindCount = items.filter((i) => i.tier === "behind").length;
      const reachedCount = items.filter((i) => i.tier === "reached").length;

      // One-line read of the whole picture, framed as a next-action.
      let headline: string;
      let subhead: string;
      if (!items.length) {
        headline = "还没有可复盘的数据";
        subhead = "完成几段专注后再回来看";
      } else if (urgentCount > 0) {
        headline = `${urgentCount} 科需要优先补`;
        subhead = "下面按紧迫程度排好了，从上往下补";
      } else if (behindCount > 0) {
        headline = `整体在轨，${behindCount} 科要加把劲`;
        subhead = "保持节奏，重点关注靠前的科目";
      } else if (reachedCount === items.length) {
        headline = "六科投入都已达标";
        subhead = "进入巩固和刷题阶段";
      } else {
        headline = "六科节奏良好";
        subhead = "按当前投入继续即可";
      }

      // v0.36 — B3 状态聚合: only surface subjects worth flagging
      // (stuck share ≥ 25%), so the section stays actionable + quiet.
      const effectiveness = buildEffectivenessBySubject(sessionsRes?.items ?? []).filter(
        (item) => item.flagged
      );

      this.setData({
        loadState: "loaded",
        items,
        urgentCount,
        behindCount,
        headline,
        subhead,
        effectiveness
      });
    } catch (error) {
      console.error("[review] dashboard failed", error);
      this.setData({ loadState: "error" });
      wx.showToast({
        title: error instanceof Error ? error.message : "加载失败",
        icon: "none"
      });
    } finally {
      wx.hideNavigationBarLoading();
    }
  }
});
