// @ts-nocheck
import { runtimeConfig } from "./config/runtime";
import { bootstrapProfile } from "./utils/api";

App<IAppOption>({
  globalData: {
    profile: null,
    bootstrapped: false,
    needsProfile: false,
    pendingProfileAction: null
  },
  async onLaunch() {
    wx.cloud.init({
      env: runtimeConfig.cloudEnv,
      traceUser: true
    });
  },
  async bootstrapProfileState() {
    const result = await bootstrapProfile();
    this.globalData.profile = result.profile;
    this.globalData.bootstrapped = true;
    this.globalData.needsProfile = result.needsOnboarding;
    return result;
  },
  queuePendingProfileAction(action) {
    this.globalData.pendingProfileAction = action;
  },
  consumePendingProfileAction() {
    const action = this.globalData.pendingProfileAction;
    this.globalData.pendingProfileAction = null;
    return action;
  }
});
