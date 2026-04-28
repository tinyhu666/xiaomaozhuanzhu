// @ts-nocheck
import { runtimeConfig } from "../../config/runtime";
import type { UserProfile } from "../../types/models";

type ProfilePageData = {
  profile: UserProfile | null;
  appVersion: string;
};

Page<{}, ProfilePageData>({
  data: {
    profile: null,
    appVersion: runtimeConfig.appVersion
  },

  async onShow() {
    const tabBar = this.getTabBar?.() as WechatMiniprogram.Component.TrivialInstance | undefined;
    tabBar?.setData?.({ selected: 2 });
    const ready = await getApp<IAppOption>().ensureProfile(this.route);
    if (!ready) return;
    this.setData({
      profile: getApp<IAppOption>().globalData.profile ?? null
    });
  },

  syncWechatProfile() {
    wx.navigateTo({
      url: "/package-profile/onboarding/index?mode=edit"
    });
  }
});
