// @ts-nocheck
import { runtimeConfig } from "./config/runtime";
import { bootstrapProfile, warmUpBackend } from "./utils/api";

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
    // Fire-and-forget probe so the cloud-run container is warm by the time
    // a page calls bootstrap / start. Errors are swallowed.
    warmUpBackend().catch(() => {});
  },
  async ensureProfile() {
    // Onboarding is intentionally bypassed in this build: the WeChat
    // login flow is unreliable, so we never navigate to the profile
    // setup page. The server still tracks `needsOnboarding`, but the
    // miniprogram simply uses default identity until login is fixed.
    try {
      const result = await bootstrapProfile();
      this.globalData.profile = result.profile;
      this.globalData.bootstrapped = true;
    } catch (error) {
      console.warn("[app] bootstrapProfile failed", error);
    }
    return true;
  }
});
