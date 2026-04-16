// @ts-nocheck
import { bootstrapProfile, getShareMe } from "../../utils/api";

type ProfilePageData = {
  profile: {
    nickname: string;
    avatarUrl: string;
    isPublic: boolean;
    requireWechatAuth: boolean;
  } | null;
  totalMinutes: string;
  streakText: string;
};

Page<{}, ProfilePageData>({
  data: {
    profile: null,
    totalMinutes: "0m",
    streakText: "0 天"
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 3 });
    const ready = await getApp<IAppOption>().ensureProfile(this.route);
    if (!ready) return;
    const bootstrap = await bootstrapProfile();
    const share = await getShareMe();
    this.setData({
      profile: bootstrap.profile,
      totalMinutes: `${share.summary.totalMinutes}m`,
      streakText: `${share.summary.currentStreakDays} 天`
    });
  },

  editProfile() {
    wx.navigateTo({
      url: "/package-profile/onboarding/index?mode=edit"
    });
  }
});
