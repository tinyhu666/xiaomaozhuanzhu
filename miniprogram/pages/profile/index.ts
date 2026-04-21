// @ts-nocheck
import type { ProfileDashboardResponse } from "../../types/models";
import { getProfileDashboard, startSession } from "../../utils/api";
import { authorizeWechatProfile } from "../../utils/profile-auth";
import { buildSubjectSummary, formatDuration } from "../../utils/view-models";

type SubjectSummaryRow = ReturnType<typeof buildSubjectSummary>[number] & {
  barStyle: string;
};

type ProfilePageData = {
  profile: ProfileDashboardResponse["profile"] | null;
  needsProfile: boolean;
  pendingStartAfterAuth: boolean;
  authLoading: boolean;
  authButtonText: string;
  totalMinutesText: string;
  bestDayDateText: string;
  bestDayDurationText: string;
  subjectRows: SubjectSummaryRow[];
};

function getPendingAuthButtonText(action: "startSession" | null) {
  return action === "startSession" ? "微信授权并开始计时" : "微信授权并开始使用";
}

Page<{}, ProfilePageData>({
  data: {
    profile: null,
    needsProfile: false,
    pendingStartAfterAuth: false,
    authLoading: false,
    authButtonText: "同步微信资料",
    totalMinutesText: "0m",
    bestDayDateText: "暂无",
    bestDayDurationText: "还没有学习记录",
    subjectRows: []
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 2 });

    try {
      const app = getApp<IAppOption>();
      const bootstrap = await app.bootstrapProfileState();

      this.setData({
        profile: bootstrap.profile,
        needsProfile: bootstrap.needsOnboarding,
        pendingStartAfterAuth: bootstrap.needsOnboarding && app.globalData.pendingProfileAction === "startSession",
        authButtonText: bootstrap.needsOnboarding
          ? getPendingAuthButtonText(app.globalData.pendingProfileAction)
          : "同步微信资料"
      });

      if (bootstrap.needsOnboarding) {
        this.setData({
          totalMinutesText: "0m",
          bestDayDateText: "暂无",
          bestDayDurationText: "完成授权后开始累计学习数据",
          subjectRows: []
        });
        return;
      }

      await this.loadProfile();
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "加载我的页面失败",
        icon: "none"
      });
    }
  },

  async loadProfile() {
    const dashboard = await getProfileDashboard();
    const subjectRows = buildSubjectSummary(dashboard.subjects);
    const maxMinutes = subjectRows[0]?.totalMinutes ?? 0;

    this.setData({
      profile: dashboard.profile,
      needsProfile: false,
      pendingStartAfterAuth: false,
      authButtonText: "同步微信资料",
      totalMinutesText: formatDuration(dashboard.summary.totalMinutes),
      bestDayDateText: dashboard.bestDay.date ? dashboard.bestDay.date.replace(/-/g, ".") : "暂无",
      bestDayDurationText: dashboard.bestDay.totalMinutes > 0 ? formatDuration(dashboard.bestDay.totalMinutes) : "还没有学习记录",
      subjectRows: subjectRows.map((item) => ({
        ...item,
        barStyle: `width: ${maxMinutes ? Math.max((item.totalMinutes / maxMinutes) * 100, 18) : 0}%`
      }))
    });
  },

  async authorizeProfile() {
    if (this.data.authLoading) return;

    this.setData({ authLoading: true });
    try {
      const app = getApp<IAppOption>();
      const profile = await authorizeWechatProfile();
      const pendingAction = app.globalData.pendingProfileAction;

      this.setData({
        profile,
        needsProfile: false,
        pendingStartAfterAuth: false,
        authButtonText: "同步微信资料"
      });

      if (pendingAction === "startSession") {
        await startSession();
        app.consumePendingProfileAction();
        wx.showToast({
          title: "已开始计时",
          icon: "success"
        });
        setTimeout(() => {
          wx.switchTab({
            url: "/pages/home/index"
          });
        }, 300);
        return;
      }

      await this.loadProfile();
      wx.showToast({
        title: "同步成功",
        icon: "success"
      });
    } catch (error) {
      const message = typeof error === "object" && error && "errMsg" in error ? String(error.errMsg) : "";
      if (message.includes("cancel")) {
        wx.showToast({
          title: "你取消了微信授权",
          icon: "none"
        });
        return;
      }

      if (!getApp<IAppOption>().globalData.needsProfile) {
        try {
          await this.loadProfile();
        } catch {
          // Keep the latest visible state if dashboard refresh also fails.
        }
      }

      wx.showToast({
        title: error instanceof Error ? error.message : "同步失败，请稍后重试",
        icon: "none"
      });
    } finally {
      this.setData({ authLoading: false });
    }
  }
});
