// @ts-nocheck
import { getShareMe, updateShareSettings } from "../../utils/api";
import { formatDuration } from "../../utils/view-models";

type SharePageData = {
  profile: {
    nickname: string;
    avatarUrl: string;
    shareSlug: string;
    isPublic: boolean;
    requireWechatAuth: boolean;
  } | null;
  totalMinutesText: string;
  streakText: string;
  sharePath: string;
};

Page<{}, SharePageData>({
  data: {
    profile: null,
    totalMinutesText: "0m",
    streakText: "0 天",
    sharePath: ""
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 2 });
    const ready = await getApp<IAppOption>().ensureProfile(this.route);
    if (!ready) return;
    await this.loadShare();
  },

  async loadShare() {
    try {
      const result = await getShareMe();
      this.setData({
        profile: result.profile,
        totalMinutesText: formatDuration(result.summary.totalMinutes),
        streakText: `${result.summary.currentStreakDays} 天`,
        sharePath: `/package-public/index?slug=${result.profile.shareSlug}`
      });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "加载共享页失败",
        icon: "none"
      });
    }
  },

  async handlePublicChange(event: WechatMiniprogram.SwitchChange) {
    if (!this.data.profile) return;
    await updateShareSettings({
      isPublic: event.detail.value,
      requireWechatAuth: this.data.profile.requireWechatAuth
    });
    await this.loadShare();
  },

  copySharePath() {
    wx.setClipboardData({
      data: this.data.sharePath
    });
  },

  previewPublicPage() {
    if (!this.data.profile) return;
    wx.navigateTo({
      url: `/package-public/index?slug=${this.data.profile.shareSlug}`
    });
  },

  onShareAppMessage() {
    if (!this.data.profile) {
      return {
        title: "我的 CPA 学习主页",
        path: "/pages/home/index"
      };
    }
    return {
      title: `${this.data.profile.nickname || "CPA 考生"}的学习主页`,
      path: this.data.sharePath
    };
  }
});
