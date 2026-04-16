// @ts-nocheck
import { runtimeConfig } from "./config/runtime";
import { bootstrapProfile } from "./utils/api";

App<IAppOption>({
  globalData: {
    profile: null,
    bootstrapped: false
  },
  async onLaunch() {
    wx.cloud.init({
      env: runtimeConfig.cloudEnv,
      traceUser: true
    });
  },
  async ensureProfile(route?: string) {
    const result = await bootstrapProfile();
    this.globalData.profile = result.profile;
    this.globalData.bootstrapped = true;

    if (result.needsOnboarding && route !== "package-profile/onboarding/index") {
      wx.navigateTo({
        url: "/package-profile/onboarding/index"
      });
      return false;
    }

    return true;
  }
});
